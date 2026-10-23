import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { createFieldCrypto } from "@/shared/field-crypto";
import { withSession, type Caller, type RlsDatabase } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createCategories, createTransactions, type Transactions } from "@/transactions/server";
import { createBudgets, type Budgets } from "./create-budgets";
import { budget } from "./schema";

// Budgets with their monthly spending, and privacy: a budget exists only for whoever may see its
// account (service and row-level security). Households and accounts are written straight into
// their tables (tests only; the table names are part of their database contract).

let db: RlsDatabase;
let transactions: Transactions;
let budgets: Budgets;
let max: Caller;
let erika: Caller;
let dora: Caller;

async function householdOf(householdId: string, ...userIds: string[]) {
  await db.execute(sql`INSERT INTO household (id, name, created_by_user_id) VALUES (${householdId}, ${householdId}, ${userIds[0]})`);
  for (const userId of userIds) {
    await db.execute(sql`INSERT INTO household_member (household_id, user_id) VALUES (${householdId}, ${userId})`);
  }
}

async function addAccount(id: string, owner: string, householdId: string | null = null) {
  await db.execute(sql`
    INSERT INTO account (id, owner_user_id, household_id, visibility, name, bank, type, role)
    VALUES (${id}, ${owner}, ${householdId}, ${householdId ? "shared" : "private"}, ${id}, 'ing', 'checking', 'everyday')`);
}

async function book(caller: Caller, accountId: string, date: string, amount: string, kind: string, category: string | null) {
  const result = await transactions.createTransaction(caller, { accountId, date, amount, kind, category });
  if (!result.ok) throw new Error(result.reason);
}

async function add(caller: Caller, accountId: string, category: string, limit: string) {
  const result = await budgets.createBudget(caller, { accountId, category, limit });
  if (!result.ok) throw new Error(result.reason);
  return result.budget;
}

async function list(caller: Caller, accountId: string, month?: string) {
  const result = await budgets.listBudgets(caller, accountId, month);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

const storedBudgets = () => db.select().from(budget);

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite() });
  db = pglite;
  await migrate(pglite, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  const crypto = createFieldCrypto({ keys: `1:${randomBytes(32).toString("base64")}`, indexKey: randomBytes(32).toString("base64") });
  transactions = createTransactions({ db, crypto, today: () => "2026-10-21" });
  budgets = createBudgets({ db, transactions });
  await householdOf("home", "max", "erika");
  await householdOf("other", "dora");
  await addAccount("max-private", "max");
  await addAccount("home-shared", "max", "home");
  await addAccount("dora-shared", "dora", "other");
  [max, erika, dora] = await Promise.all(["max", "erika", "dora"].map((id) => createTestSession(db, id)));
});

describe("spending per budget", () => {
  it("counts a group's subcategories, a subcategory only itself, and lowers it by refunds", async () => {
    await add(max, "max-private", "groceries", "400,00");
    await add(max, "max-private", "groceries.drugstore", "50,00");
    await book(max, "max-private", "2026-10-02", "-100,00", "expense", "groceries.supermarket");
    await book(max, "max-private", "2026-10-03", "-20,00", "expense", "groceries.drugstore");
    await book(max, "max-private", "2026-10-04", "-5,00", "expense", "groceries");
    await book(max, "max-private", "2026-10-05", "10,00", "expense", "groceries.supermarket");

    const result = await list(max, "max-private", "2026-10");
    expect(result.month).toBe("2026-10");
    expect(result.budgets.map(({ category, limitCents, spentCents }) => ({ category, limitCents, spentCents }))).toEqual([
      { category: "groceries", limitCents: 40000, spentCents: 11500 },
      { category: "groceries.drugstore", limitCents: 5000, spentCents: 2000 },
    ]);
  });

  it("never counts income, transfers, saving, other categories or other months", async () => {
    await add(max, "max-private", "groceries", "400,00");
    await book(max, "max-private", "2026-10-02", "50,00", "income", "reimbursements");
    await book(max, "max-private", "2026-10-03", "-50,00", "transfer", null);
    await book(max, "max-private", "2026-10-04", "-50,00", "saving", null);
    await book(max, "max-private", "2026-10-05", "-50,00", "expense", "health");
    await book(max, "max-private", "2026-09-30", "-50,00", "expense", "groceries");

    expect((await list(max, "max-private", "2026-10")).budgets[0].spentCents).toBe(0);
  });

  it("uses the current month without a month", async () => {
    await add(max, "max-private", "health", "30,00");
    await book(max, "max-private", "2026-10-21", "-12,34", "expense", "health.pharmacy");
    const result = await list(max, "max-private");
    expect(result.month).toBe("2026-10");
    expect(result.budgets[0].spentCents).toBe(1234);
  });

  it("rejects an invalid month", async () => {
    expect(await budgets.listBudgets(max, "max-private", "2026-13")).toEqual({ ok: false, reason: "invalid-input" });
  });
});

describe("adding, changing and deleting budgets", () => {
  it("adds a budget with its limit in cents", async () => {
    const created = await add(max, "max-private", "groceries", "1.234,56");
    expect(created).toMatchObject({ accountId: "max-private", category: "groceries", limitCents: 123456, spentCents: 0 });
  });

  it("rejects a second budget for the same account and category", async () => {
    await add(max, "max-private", "groceries", "400,00");
    expect(await budgets.createBudget(max, { accountId: "max-private", category: "groceries", limit: "1,00" })).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("rejects income categories, unknown categories and limits of zero or below", async () => {
    for (const input of [
      { accountId: "max-private", category: "salary", limit: "1,00" },
      { accountId: "max-private", category: "nonsense", limit: "1,00" },
      { accountId: "max-private", category: "groceries", limit: "0" },
      { accountId: "max-private", category: "groceries", limit: "-5,00" },
      { accountId: "max-private", category: "groceries", limit: "abc" },
    ]) {
      expect(await budgets.createBudget(max, input)).toEqual({ ok: false, reason: "invalid-input" });
    }
  });

  it("changes only the limit", async () => {
    const created = await add(max, "max-private", "groceries", "400,00");
    const result = await budgets.updateBudget(max, created.id, { limit: "450,00", category: "health" });
    expect(result).toMatchObject({ ok: true, budget: { category: "groceries", limitCents: 45000 } });
    expect(await budgets.updateBudget(max, created.id, { limit: "0" })).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("deletes a budget", async () => {
    const created = await add(max, "max-private", "groceries", "400,00");
    expect(await budgets.deleteBudget(max, created.id)).toBe(true);
    expect(await storedBudgets()).toEqual([]);
    expect(await budgets.deleteBudget(max, created.id)).toBe(false);
  });
});

describe("privacy", () => {
  it("hides a private account's budgets from other members, as if the account did not exist", async () => {
    const own = await add(max, "max-private", "groceries", "400,00");

    expect(await budgets.listBudgets(erika, "max-private")).toEqual({ ok: false, reason: "not-found" });
    expect(await budgets.updateBudget(erika, own.id, { limit: "1,00" })).toEqual({ ok: false, reason: "not-found" });
    expect(await budgets.deleteBudget(erika, own.id)).toBe(false);
    expect(await budgets.createBudget(erika, { accountId: "max-private", category: "health", limit: "1,00" })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await storedBudgets()).toMatchObject([{ id: own.id, limitCents: 40000 }]);
  });

  it("lets every member see and change a shared account's budgets, and no other household", async () => {
    const shared = await add(max, "home-shared", "groceries", "400,00");
    await book(erika, "home-shared", "2026-10-02", "-30,00", "expense", "groceries");

    expect((await list(erika, "home-shared")).budgets).toMatchObject([{ id: shared.id, spentCents: 3000 }]);
    expect(await budgets.updateBudget(erika, shared.id, { limit: "500,00" })).toMatchObject({ ok: true });
    expect(await budgets.listBudgets(dora, "home-shared")).toEqual({ ok: false, reason: "not-found" });
    expect(await budgets.deleteBudget(dora, shared.id)).toBe(false);
    expect(await budgets.deleteBudget(erika, shared.id)).toBe(true);
  });

  it("hides a shared account's budgets from the others once it becomes private", async () => {
    await add(erika, "home-shared", "groceries", "400,00");
    await db.execute(sql`UPDATE account SET visibility = 'private', household_id = NULL WHERE id = 'home-shared'`);
    expect(await budgets.listBudgets(erika, "home-shared")).toEqual({ ok: false, reason: "not-found" });
    expect((await list(max, "home-shared")).budgets).toHaveLength(1);
  });

  it("row-level security hides and protects budgets of invisible accounts", async () => {
    const own = await add(max, "max-private", "groceries", "400,00");
    await withSession(db, erika, async (tx) => {
      expect(await tx.select().from(budget)).toEqual([]);
      await tx.update(budget).set({ limitCents: 1 });
      await tx.delete(budget);
    });
    expect(await storedBudgets()).toMatchObject([{ id: own.id, limitCents: 40000 }]);

    const insert = (caller: Caller, accountId: string, createdBy: string) =>
      withSession(db, caller, (tx) =>
        tx.insert(budget).values({ id: crypto.randomUUID(), accountId, category: "health", limitCents: 100, createdByUserId: createdBy }),
      );
    await expect(insert(erika, "max-private", "erika")).rejects.toThrow();
    await expect(insert(erika, "home-shared", "max")).rejects.toThrow();
    await expect(insert(erika, "home-shared", "erika")).resolves.toBeDefined();
  });
});

describe("a stored budget", () => {
  it("keeps its account and creator; only its limit changes", async () => {
    const created = await add(max, "home-shared", "groceries", "300,00");
    const asErika = <T,>(fn: Parameters<typeof withSession<T>>[2]) => withSession(db, erika, fn);
    await expect(asErika((tx) => tx.update(budget).set({ accountId: "max-private" }).where(sql`${budget.id} = ${created.id}`))).rejects.toThrow();
    await expect(asErika((tx) => tx.update(budget).set({ createdByUserId: "erika" }).where(sql`${budget.id} = ${created.id}`))).rejects.toThrow();
    expect((await budgets.updateBudget(erika, created.id, { limit: "350,00" })).ok).toBe(true);
    const [stored] = await storedBudgets();
    expect(stored).toMatchObject({ accountId: "home-shared", createdByUserId: "max", limitCents: 35000 });
  });
});

describe("budgets for own categories", () => {
  async function own(caller: Caller, input: Record<string, unknown>) {
    const result = await createCategories({ db }).createCategory(caller, { scope: "household", kind: "expense", ...input });
    if (!result.ok) throw new Error(result.reason);
    return result.category;
  }

  it("accepts household categories everywhere and personal ones on the owner's private account, with their spending", async () => {
    const pets = await own(max, { name: "Haustiere" });
    const vet = await own(max, { parentKey: pets.key, name: "Tierarzt" });
    const hobby = await own(max, { scope: "personal", name: "Modellbau" });
    await book(max, "home-shared", "2026-10-03", "-30,00", "expense", vet.key);
    const shared = await budgets.createBudget(erika, { accountId: "home-shared", category: pets.key, limit: "100,00" });
    expect(shared).toMatchObject({ ok: true, budget: { category: pets.key, spentCents: 3000 } });
    expect(await budgets.createBudget(max, { accountId: "max-private", category: hobby.key, limit: "50,00" })).toMatchObject({ ok: true });
  });

  it("rejects personal categories on shared accounts, other people's categories, income and archived ones", async () => {
    const hobby = await own(max, { scope: "personal", name: "Modellbau" });
    const pets = await own(max, { name: "Haustiere" });
    const bonus = await own(max, { kind: "income", parentKey: "salary", name: "Bonus" });
    const invalid = { ok: false, reason: "invalid-input" };
    expect(await budgets.createBudget(max, { accountId: "home-shared", category: hobby.key, limit: "1,00" })).toEqual(invalid);
    expect(await budgets.createBudget(dora, { accountId: "dora-shared", category: pets.key, limit: "1,00" })).toEqual(invalid);
    expect(await budgets.createBudget(max, { accountId: "max-private", category: bonus.key, limit: "1,00" })).toEqual(invalid);
    expect(await budgets.createBudget(max, { accountId: "max-private", category: "salary", limit: "1,00" })).toEqual(invalid);
    await createCategories({ db }).setArchived(max, pets.id, true);
    expect(await budgets.createBudget(max, { accountId: "max-private", category: pets.key, limit: "1,00" })).toEqual(invalid);
  });
});
