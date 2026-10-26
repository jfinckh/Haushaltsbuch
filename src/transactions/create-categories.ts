import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import { currentHouseholdId } from "@/db-contract/server";
import { withSession, type Caller, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import { CATEGORY_GROUPS, categoryKeysFor, standardChoices, type CategoryCatalog, type CategoryChoice } from "./categories";
import type { Categories, CategoryScopeView, CategoryView, HideCategoryResult, ListCategoriesResult, SaveCategoryResult } from "./contract";
import { category, hiddenCategory } from "./schema";
import { archiveCategorySchema, createCategorySchema, hideCategorySchema, renameCategorySchema, type CategoryScope } from "./validation";

export type CategoriesOptions = { db: RlsDatabase };

type CategoryRow = typeof category.$inferSelect;

/** The key of an own category: its own part, under its parent for a subcategory. */
const ownKey = (id: string) => `c_${id}`;
const keyOf = (row: CategoryRow) => (row.parentKey ? `${row.parentKey}.${ownKey(row.id)}` : ownKey(row.id));

const toView = (row: CategoryRow): CategoryView => ({
  id: row.id,
  key: keyOf(row),
  scope: row.householdId ? "household" : "personal",
  kind: row.kind,
  parentKey: row.parentKey,
  name: row.name,
  archived: row.archived,
});

/** Every standard key (groups and subcategories) of both kinds. */
const STANDARD_KEYS = new Set([...categoryKeysFor("expense"), ...categoryKeysFor("income")]);

/** The rows of one scope: the household's, or the caller's own personal ones. */
function scopeFilter(table: typeof category | typeof hiddenCategory, scope: CategoryScope, householdId: string | null, userId: string): SQL {
  return scope === "household" ? eq(table.householdId, householdId ?? "") : and(eq(table.ownerUserId, userId), isNull(table.householdId))!;
}

/**
 * The category part of transactions: own categories of a household or of one person, and hidden
 * standard keys. Every call runs in the caller's session; row-level security shows household rows to
 * its members and personal rows to their owner only.
 */
export function createCategories({ db }: CategoriesOptions): Categories {
  /** Whether an active category with this name (any case) exists under the same parent in the scope. */
  async function nameTaken(tx: RlsTransaction, row: Pick<CategoryRow, "householdId" | "ownerUserId" | "parentKey" | "kind" | "name">, exceptId?: string) {
    const scope = row.householdId ? eq(category.householdId, row.householdId) : eq(category.ownerUserId, row.ownerUserId ?? "");
    const rows = await tx
      .select({ id: category.id })
      .from(category)
      .where(
        and(
          scope,
          row.parentKey === null ? isNull(category.parentKey) : eq(category.parentKey, row.parentKey),
          eq(category.kind, row.kind),
          eq(category.archived, false),
          sql`lower(${category.name}) = lower(${row.name})`,
          exceptId ? ne(category.id, exceptId) : undefined,
        ),
      );
    return rows.length > 0;
  }

  /** Whether `parentKey` is a fitting parent: a standard group of the kind, or an active own group of the scope and kind. */
  async function parentFits(tx: RlsTransaction, parentKey: string, kind: "expense" | "income", scope: SQL): Promise<boolean> {
    if (CATEGORY_GROUPS.some((group) => group.key === parentKey && group.kind === kind)) return true;
    if (!/^c_[^.]+$/.test(parentKey)) return false;
    const [parent] = await tx
      .select({ id: category.id })
      .from(category)
      .where(and(eq(category.id, parentKey.slice(2)), scope, isNull(category.parentKey), eq(category.kind, kind), eq(category.archived, false)));
    return parent !== undefined;
  }

  async function findVisible(tx: RlsTransaction, id: string): Promise<CategoryRow | null> {
    const [row] = await tx.select().from(category).where(eq(category.id, id)).for("update");
    return row ?? null;
  }

  async function update(caller: Caller, id: string, change: (row: CategoryRow) => Partial<CategoryRow> | null): Promise<SaveCategoryResult> {
    return withSession(db, caller, async (tx): Promise<SaveCategoryResult> => {
      const row = await findVisible(tx, id);
      if (!row) return { ok: false, reason: "not-found" };
      const changes = change(row);
      if (!changes) return { ok: false, reason: "invalid-input" };
      const next = { ...row, ...changes };
      if (!next.archived && (await nameTaken(tx, next, row.id))) return { ok: false, reason: "duplicate" };
      const [saved] = await tx
        .update(category)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(category.id, row.id))
        .returning();
      return { ok: true, category: toView(saved) };
    });
  }

  return {
    async listCategories(caller: Caller): Promise<ListCategoriesResult> {
      return withSession(db, caller, async (tx, userId): Promise<ListCategoriesResult> => {
        const householdId = await currentHouseholdId(tx);
        const scopeView = async (scope: CategoryScope): Promise<CategoryScopeView> => {
          const hidden = await tx
            .select({ key: hiddenCategory.key })
            .from(hiddenCategory)
            .where(scopeFilter(hiddenCategory, scope, householdId, userId))
            .orderBy(asc(hiddenCategory.key));
          const rows = await tx
            .select()
            .from(category)
            .where(scopeFilter(category, scope, householdId, userId))
            .orderBy(asc(category.kind), sql`${category.parentKey} NULLS FIRST`, asc(category.name), asc(category.id));
          return { hidden: hidden.map((row) => row.key), categories: rows.map(toView) };
        };
        return { household: householdId ? await scopeView("household") : null, personal: await scopeView("personal") };
      });
    },

    async catalog(caller: Caller): Promise<CategoryCatalog> {
      return withSession(db, caller, async (tx, userId): Promise<CategoryCatalog> => {
        const householdId = await currentHouseholdId(tx);
        // Row-level security returns only the household's rows and the caller's own personal ones.
        const rows = await tx.select().from(category).orderBy(asc(category.name), asc(category.id));
        const hidden = await tx.select().from(hiddenCategory);
        const isPersonal = (row: { ownerUserId: string | null }) => row.ownerUserId === userId;
        const inScope = (row: { householdId: string | null; ownerUserId: string | null }, withPersonal: boolean) =>
          (householdId !== null && row.householdId === householdId) || (withPersonal && isPersonal(row));

        const choices = (withPersonal: boolean): CategoryChoice[] => {
          const hiddenKeys = new Set(hidden.filter((row) => inScope(row, withPersonal)).map((row) => row.key));
          const own = rows.filter((row) => !row.archived && inScope(row, withPersonal));
          const subsOf = (key: string) => own.filter((row) => row.parentKey === key).map((row) => ({ key: keyOf(row), name: row.name }));
          const standard = standardChoices()
            .filter((group) => !hiddenKeys.has(group.key))
            .map((group) => ({ ...group, subcategories: [...group.subcategories.filter((sub) => !hiddenKeys.has(sub.key)), ...subsOf(group.key)] }));
          const ownGroups = own
            .filter((row) => row.parentKey === null)
            .map((row) => ({ key: keyOf(row), kind: row.kind, name: row.name, subcategories: subsOf(keyOf(row)) }));
          // Own groups follow the standard groups of their type.
          return (["expense", "income"] as const).flatMap((kind) => [...standard, ...ownGroups].filter((group) => group.kind === kind));
        };

        return {
          names: Object.fromEntries(rows.filter((row) => inScope(row, true)).map((row) => [keyOf(row), row.name])),
          shared: choices(false),
          private: choices(true),
        };
      });
    },

    async createCategory(caller: Caller, input: unknown): Promise<SaveCategoryResult> {
      const parsed = createCategorySchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const { scope, kind, parentKey, name } = parsed.data;
      return withSession(db, caller, async (tx, userId): Promise<SaveCategoryResult> => {
        const householdId = await currentHouseholdId(tx);
        if (scope === "household" && !householdId) return { ok: false, reason: "not-found" };
        if (parentKey !== null && !(await parentFits(tx, parentKey, kind, scopeFilter(category, scope, householdId, userId)))) {
          return { ok: false, reason: "invalid-input" };
        }
        const row = {
          householdId: scope === "household" ? householdId : null,
          ownerUserId: scope === "personal" ? userId : null,
          kind,
          parentKey,
          name,
        };
        if (await nameTaken(tx, row)) return { ok: false, reason: "duplicate" };
        const [saved] = await tx
          .insert(category)
          .values({ id: randomUUID(), ...row, createdByUserId: userId })
          .returning();
        return { ok: true, category: toView(saved) };
      });
    },

    async renameCategory(caller: Caller, id: string, input: unknown): Promise<SaveCategoryResult> {
      const parsed = renameCategorySchema.safeParse(input);
      return update(caller, id, () => (parsed.success ? { name: parsed.data.name } : null));
    },

    async setArchived(caller: Caller, id: string, archived: unknown): Promise<SaveCategoryResult> {
      const parsed = archiveCategorySchema.safeParse({ archived });
      return update(caller, id, () => (parsed.success ? { archived: parsed.data.archived } : null));
    },

    async setHidden(caller: Caller, input: unknown): Promise<HideCategoryResult> {
      const parsed = hideCategorySchema.safeParse(input);
      if (!parsed.success || !STANDARD_KEYS.has(parsed.data.key)) return { ok: false, reason: "invalid-input" };
      const { scope, key, hidden } = parsed.data;
      return withSession(db, caller, async (tx, userId): Promise<HideCategoryResult> => {
        const householdId = await currentHouseholdId(tx);
        if (scope === "household" && !householdId) return { ok: false, reason: "not-found" };
        if (hidden) {
          await tx
            .insert(hiddenCategory)
            .values({
              id: randomUUID(),
              householdId: scope === "household" ? householdId : null,
              ownerUserId: scope === "personal" ? userId : null,
              key,
              createdByUserId: userId,
            })
            .onConflictDoNothing();
        } else {
          await tx.delete(hiddenCategory).where(and(scopeFilter(hiddenCategory, scope, householdId, userId), eq(hiddenCategory.key, key)));
        }
        return { ok: true };
      });
    },
  };
}

