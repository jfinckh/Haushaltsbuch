import { desc, eq, sql } from "drizzle-orm";
import type { FieldCrypto } from "@/shared/field-crypto";
import { withSession, type Caller, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import type { BookingStore, TransactionView } from "@/transactions/server";
import type { ApplyToAccountResult, Rules, SaveRuleResult } from "./contract";
import { normalizeText, pickRule, type MatchableRule, type RuleLevel } from "./matching";
import { bookingRule, ruleSuggestionDismissal } from "./schema";
import { findSuggestions, type RuleSuggestion, type SuggestionField } from "./suggestions";
import type { ApplyResult, RuleScope, RuleView } from "./types";
import { applyRulesSchema, dismissSuggestionSchema, learnRuleSchema, ruleInputSchema, type RuleValues } from "./validation";

export type RulesOptions = {
  db: RlsDatabase;
  /** Encrypts the patterns; keys come from the environment. */
  crypto: FieldCrypto;
  /** Reads bookings and sets their type and category. */
  transactions: Pick<BookingStore, "findBookings" | "checkCategory" | "classifyBookings">;
};

const CONTEXT = {
  counterparty: "rule.counterpartyPattern",
  reference: "rule.referencePattern",
} as const;

type RuleRow = typeof bookingRule.$inferSelect;

/** A visible account and its household; null household: a private account (always the caller's). */
type AccountScope = { account_id: string; household_id: string | null };

async function rows<T>(tx: RlsTransaction, query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await tx.execute(query)) as unknown as { rows: T[] }).rows;
}

const textArray = (ids: readonly string[]) =>
  ids.length === 0 ? sql`ARRAY[]::text[]` : sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::text[]`;

const levelOf = (row: RuleRow): RuleLevel => (row.accountId ? "account" : row.ownerUserId ? "private" : "shared");

const isTransferKind = (kind: string) => kind === "transfer" || kind === "saving";

const suggestionContext = (field: SuggestionField) => `rule-suggestion.${field}`;

/** The same calendar day a year before `today` (YYYY-MM-DD). */
function yearBefore(today: string): string {
  const [year, rest] = [Number(today.slice(0, 4)), today.slice(4)];
  return `${year - 1}${rest === "-02-29" ? "-02-28" : rest}`;
}

/**
 * The rules part. Every call is about the caller's own view; their user id comes from the database.
 * Row-level security shows each member the rules of accounts they may see, the household's shared
 * rules and their own private rules (drizzle/0018_rules_functions.sql). Rules run only on bookings
 * the caller may see, and only when the rule's scope fits the booking's account.
 */
export function createRules({ db, crypto: fieldCrypto, transactions }: RulesOptions): Rules {
  const decrypt = (value: string | null, context: string) => (value === null ? null : fieldCrypto.decrypt(value, context));
  const encrypt = (value: string | null, context: string) => (value === null ? null : fieldCrypto.encrypt(value, context));

  function toView(row: RuleRow, userId: string): RuleView {
    const scope: RuleScope = row.accountId
      ? { type: "account", accountId: row.accountId }
      : row.ownerUserId
        ? { type: "private" }
        : { type: "shared" };
    return {
      id: row.id,
      scope,
      counterparty: decrypt(row.counterpartyPatternEncrypted, CONTEXT.counterparty),
      reference: decrypt(row.referencePatternEncrypted, CONTEXT.reference),
      amountSign: row.amountSign,
      kind: row.resultKind,
      category: row.resultCategory,
      transferTarget: row.transferTarget,
      createdByMe: row.createdByUserId === userId,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async function accountScopes(tx: RlsTransaction, accountIds: string[]): Promise<Map<string, AccountScope>> {
    if (accountIds.length === 0) return new Map();
    const found = await rows<AccountScope>(
      tx,
      sql`SELECT account_id, household_id FROM accounts_visible_account_scopes() WHERE account_id = ANY(${textArray(accountIds)})`,
    );
    return new Map(found.map((row) => [row.account_id, row]));
  }

  /** The stored scope columns for a scope the caller may use, or why not. */
  async function scopeColumns(tx: RlsTransaction, userId: string, scope: RuleValues["scope"]) {
    if (scope.type === "account") {
      const visible = (await accountScopes(tx, [scope.accountId])).has(scope.accountId);
      return visible ? { ok: true as const, columns: { accountId: scope.accountId, householdId: null, ownerUserId: null } } : ({ ok: false, reason: "not-found" } as const);
    }
    if (scope.type === "private") {
      return { ok: true as const, columns: { accountId: null, householdId: null, ownerUserId: userId } };
    }
    const [household] = await rows<{ id: string }>(tx, sql`SELECT households_current_user_household_ids() AS id LIMIT 1`);
    return household
      ? { ok: true as const, columns: { accountId: null, householdId: household.id, ownerUserId: null } }
      : ({ ok: false, reason: "no-household" } as const);
  }

  function valueColumns(values: RuleValues) {
    return {
      counterpartyPatternEncrypted: encrypt(values.counterparty, CONTEXT.counterparty),
      referencePatternEncrypted: encrypt(values.reference, CONTEXT.reference),
      amountSign: values.amountSign,
      resultKind: values.kind,
      resultCategory: values.category,
      transferTarget: values.transferTarget,
    };
  }

  async function findVisible(tx: RlsTransaction, id: string) {
    const [row] = await tx.select().from(bookingRule).where(eq(bookingRule.id, id));
    return row ?? null;
  }

  /**
   * Whether the rule's category fits its scope (transactions' check): a personal category only for
   * private accounts, never someone else's. An unchanged category may stay when it was archived.
   */
  async function categoryFits(tx: RlsTransaction, values: RuleValues, previousCategory: string | null = null) {
    if (values.category === null) return true;
    const target = values.scope.type === "account" ? values.scope.accountId : { visibility: values.scope.type };
    return transactions.checkCategory(tx, target, values.kind, values.category, { allowArchived: values.category === previousCategory });
  }

  async function insertRule(tx: RlsTransaction, userId: string, values: RuleValues): Promise<SaveRuleResult> {
    const scope = await scopeColumns(tx, userId, values.scope);
    if (!scope.ok) return scope;
    if (!(await categoryFits(tx, values))) return { ok: false, reason: "invalid-input" };
    const [row] = await tx
      .insert(bookingRule)
      .values({ id: crypto.randomUUID(), ...scope.columns, ...valueColumns(values), createdByUserId: userId })
      .returning();
    return { ok: true, rule: toView(row, userId) };
  }

  /**
   * Applies the rules that fit each booking's account, as the caller may see them. Bookings someone
   * classified by hand are skipped by transactions.
   */
  /** For each booking the visible rule that wins, if any; bookings on invisible accounts get none. */
  async function winningRules(tx: RlsTransaction, userId: string, bookings: TransactionView[]) {
    const scopes = await accountScopes(tx, [...new Set(bookings.map((b) => b.accountId))]);
    const visibleRules = await tx.select().from(bookingRule);
    const matchable = visibleRules.map((row) => ({ row, view: toView(row, userId) }));

    const fitsAccount = (row: RuleRow, scope: AccountScope) =>
      row.accountId === scope.account_id ||
      (row.householdId !== null && row.householdId === scope.household_id) ||
      (row.ownerUserId !== null && row.ownerUserId === userId && scope.household_id === null);

    return bookings.flatMap((booking) => {
      const scope = scopes.get(booking.accountId);
      if (!scope) return [];
      const candidates = matchable
        .filter(({ row }) => fitsAccount(row, scope))
        .map(({ row, view }): MatchableRule & { view: RuleView } => ({
          id: row.id,
          level: levelOf(row),
          counterparty: view.counterparty,
          reference: view.reference,
          amountSign: view.amountSign,
          updatedAt: view.updatedAt,
          view,
        }));
      const winner = pickRule(candidates, booking);
      return winner ? [{ booking, rule: winner.view }] : [];
    });
  }

  async function apply(tx: RlsTransaction, userId: string, bookings: TransactionView[]): Promise<ApplyResult> {
    if (bookings.length === 0) return { applied: 0, transfers: [] };
    const decisions = await winningRules(tx, userId, bookings);

    const changed = new Set(
      await transactions.classifyBookings(
        tx,
        decisions.map(({ booking, rule }) => ({ id: booking.id, kind: rule.kind, category: rule.category })),
      ),
    );
    const transfers = decisions
      .filter(({ booking, rule }) => changed.has(booking.id) && isTransferKind(rule.kind))
      .map(({ booking, rule }) => ({ id: booking.id, target: rule.transferTarget }));
    return { applied: changed.size, transfers };
  }

  return {
    async listRules(caller: Caller): Promise<RuleView[]> {
      return withSession(db, caller, async (tx, userId) => {
        const found = await tx.select().from(bookingRule).orderBy(desc(bookingRule.updatedAt), bookingRule.id);
        return found.map((row) => toView(row, userId));
      });
    },

    async getRule(caller: Caller, id: string): Promise<RuleView | null> {
      return withSession(db, caller, async (tx, userId) => {
        const row = await findVisible(tx, id);
        return row && toView(row, userId);
      });
    },

    async createRule(caller: Caller, input: unknown): Promise<SaveRuleResult> {
      const parsed = ruleInputSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      return withSession(db, caller, (tx, userId) => insertRule(tx, userId, parsed.data));
    },

    async updateRule(caller: Caller, id: string, input: unknown): Promise<SaveRuleResult> {
      const parsed = ruleInputSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      return withSession(db, caller, async (tx, userId): Promise<SaveRuleResult> => {
        const existing = await findVisible(tx, id);
        if (!existing) return { ok: false, reason: "not-found" };
        const scope = await scopeColumns(tx, userId, parsed.data.scope);
        if (!scope.ok) return scope;
        if (!(await categoryFits(tx, parsed.data, existing.resultCategory))) return { ok: false, reason: "invalid-input" };
        const [row] = await tx
          .update(bookingRule)
          .set({ ...scope.columns, ...valueColumns(parsed.data), updatedAt: new Date() })
          .where(eq(bookingRule.id, id))
          .returning();
        return row ? { ok: true, rule: toView(row, userId) } : { ok: false, reason: "not-found" };
      });
    },

    async deleteRule(caller: Caller, id: string): Promise<boolean> {
      return withSession(db, caller, async (tx) => {
        const deleted = await tx.delete(bookingRule).where(eq(bookingRule.id, id)).returning({ id: bookingRule.id });
        return deleted.length > 0;
      });
    },

    async createFromBooking(
      caller: Caller,
      bookingId: string,
      input: unknown,
      transferTarget: "external" | null = null,
    ): Promise<SaveRuleResult> {
      const parsed = learnRuleSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const { field, pattern } = parsed.data;
      return withSession(db, caller, async (tx, userId): Promise<SaveRuleResult> => {
        const [booking] = await transactions.findBookings(tx, userId, { ids: [bookingId] });
        if (!booking) return { ok: false, reason: "not-found" };
        const text = booking[field];
        if (!text || !normalizeText(text).includes(normalizeText(pattern))) return { ok: false, reason: "invalid-input" };
        const values = ruleInputSchema.safeParse({
          scope: { type: "account", accountId: booking.accountId },
          counterparty: field === "counterparty" ? pattern : null,
          reference: field === "reference" ? pattern : null,
          // A transfer's direction matters ("from" Max is not "to" Max); an expense rule also
          // catches refunds, so it keeps no sign.
          amountSign: isTransferKind(booking.kind) ? (booking.amountCents < 0 ? "negative" : "positive") : null,
          kind: booking.kind,
          category: isTransferKind(booking.kind) ? null : booking.category,
          transferTarget: isTransferKind(booking.kind) ? transferTarget : null,
        });
        if (!values.success) return { ok: false, reason: "invalid-input" };
        return insertRule(tx, userId, values.data);
      });
    },

    async listSuggestions(caller: Caller, { today = new Date().toISOString().slice(0, 10) }: { today?: string } = {}): Promise<RuleSuggestion[]> {
      return withSession(db, caller, async (tx, userId) => {
        const found = await transactions.findBookings(tx, userId, { from: yearBefore(today), to: today });
        const open = found.filter((b) => b.kind === "expense" || b.kind === "income");
        const covered = new Set((await winningRules(tx, userId, open)).map(({ booking }) => booking.id));
        const dismissed = new Set(
          (await tx.select().from(ruleSuggestionDismissal)).map((row) => `${row.field}:${row.patternIndex}`),
        );
        return findSuggestions(
          open.filter((b) => !covered.has(b.id)),
          (field, pattern) => dismissed.has(`${field}:${fieldCrypto.blindIndex(pattern, suggestionContext(field))}`),
        );
      });
    },

    async dismissSuggestion(caller: Caller, input: unknown): Promise<boolean> {
      const parsed = dismissSuggestionSchema.safeParse(input);
      if (!parsed.success) return false;
      const { field, pattern } = parsed.data;
      return withSession(db, caller, async (tx, userId) => {
        await tx
          .insert(ruleSuggestionDismissal)
          .values({
            id: crypto.randomUUID(),
            ownerUserId: userId,
            field,
            patternIndex: fieldCrypto.blindIndex(normalizeText(pattern), suggestionContext(field)),
          })
          .onConflictDoNothing();
        return true;
      });
    },

    async applyToBookings(caller: Caller, bookingIds: string[]): Promise<ApplyResult> {
      if (bookingIds.length === 0) return { applied: 0, transfers: [] };
      return withSession(db, caller, async (tx, userId) => {
        const bookings = await transactions.findBookings(tx, userId, { ids: bookingIds });
        return apply(tx, userId, bookings.filter((b) => b.classifiedBy === "auto"));
      });
    },

    async applyToAccount(caller: Caller, input: unknown): Promise<ApplyToAccountResult> {
      const parsed = applyRulesSchema.safeParse(typeof input === "string" ? { accountId: input } : input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const { accountId } = parsed.data;
      return withSession(db, caller, async (tx, userId) => {
        if (!(await accountScopes(tx, [accountId])).has(accountId)) return { ok: false as const, reason: "not-found" as const };
        const bookings = await transactions.findBookings(tx, userId, { accountId, uncategorized: true });
        return { ok: true as const, ...(await apply(tx, userId, bookings)) };
      });
    },
  };
}

