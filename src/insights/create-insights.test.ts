import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { createFieldCrypto } from "@/shared/field-crypto";
import type { Caller, RlsDatabase } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createTransactions, type Transactions } from "@/transactions/server";
import { createTransfers, type Transfers } from "@/transfers/server";
import type { Insights } from "./contract";
import { createInsights } from "./create-insights";

// The figures with the real bookings and transfers services on an in-memory database, and privacy:
// nobody gets figures of an account they may not see, and "Alle privaten Konten" never mixes members.
// Households and accounts are written straight into their tables (tests only; the table names are
// part of their database contract).

const TODAY = "2026-10-21";

let db: RlsDatabase;
let transactions: Transactions;
let transfers: Transfers;
let insights: Insights;
let max: Caller;
let erika: Caller;
let dora: Caller;

async function householdOf(householdId: string, ...userIds: string[]) {
  await db.execute(sql`INSERT INTO household (id, name, created_by_user_id) VALUES (${householdId}, ${householdId}, ${userIds[0]})`);
  for (const userId of userIds) {
    await db.execute(sql`INSERT INTO household_member (household_id, user_id) VALUES (${householdId}, ${userId})`);
  }
}

async function addAccount(id: string, owner: string, householdId: string | null = null, role: "everyday" | "savings" = "everyday") {
  await db.execute(sql`
    INSERT INTO account (id, owner_user_id, household_id, visibility, name, bank, type, role)
    VALUES (${id}, ${owner}, ${householdId}, ${householdId ? "shared" : "private"}, ${id}, 'ing', 'checking', ${role})`);
}

async function book(caller: Caller, accountId: string, date: string, amount: string, kind: string, category: string | null = null) {
  const result = await transactions.createTransaction(caller, { accountId, date, amount, kind, category });
  if (!result.ok) throw new Error(result.reason);
  return result.transaction.id;
}

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite() });
  await migrate(pglite, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  db = pglite;
  const crypto = createFieldCrypto({ keys: `1:${randomBytes(32).toString("base64")}`, indexKey: randomBytes(32).toString("base64") });
  transactions = createTransactions({ db, crypto, today: () => TODAY });
  transfers = createTransfers({ db, crypto, transactions, today: () => TODAY });
  insights = createInsights({ transactions, transfers, today: () => TODAY });
  await householdOf("home", "max", "erika");
  await householdOf("other", "dora");
  await addAccount("max-giro", "max");
  await addAccount("max-tr", "max", null, "savings");
  await addAccount("shared", "erika", "home");
  await addAccount("erika-giro", "erika");
  await addAccount("dora-giro", "dora");
  [max, erika, dora] = await Promise.all(["max", "erika", "dora"].map((id) => createTestSession(db, id)));

  // Max: salary, groceries, a refund, saving into his depot, and rent paid into the shared account.
  await book(max, "max-giro", "2026-10-01", "2.000,00", "income", "salary");
  await book(max, "max-giro", "2026-10-05", "-300,00", "expense", "groceries");
  await book(max, "max-giro", "2026-10-06", "50,00", "expense", "groceries");
  await book(max, "max-giro", "2026-10-07", "-250,00", "saving");
  await book(max, "max-tr", "2026-10-07", "250,00", "saving");
  const rent = await book(max, "max-giro", "2026-10-02", "-800,00", "transfer");
  const received = await book(erika, "shared", "2026-10-02", "800,00", "transfer");
  expect(await transfers.link(max, rent, received)).toBe("ok");
  await book(max, "max-giro", "2026-09-01", "1.000,00", "income", "salary");
  await book(max, "max-giro", "2026-09-10", "-400,00", "expense", "leisure");
  // Erika's private account and the shared account's own spending.
  await book(erika, "erika-giro", "2026-10-01", "3.000,00", "income", "salary");
  await book(erika, "erika-giro", "2026-10-03", "-999,00", "expense", "shopping");
  await book(erika, "shared", "2026-10-04", "-120,00", "expense", "housing");
  await book(dora, "dora-giro", "2026-10-01", "500,00", "income", "salary");
});

describe("month figures", () => {
  it("gives one account's current month, without contribution", async () => {
    expect(await insights.monthFigures(max, "max-giro")).toEqual({
      ok: true,
      month: "2026-10",
      incomeCents: 200000,
      expenseCents: -25000,
      savingCents: -25000,
      contributionCents: null,
      availableCents: 150000,
    });
  });

  it("adds the contribution to shared accounts for Alle privaten Konten, lowering what is available", async () => {
    // The depot's incoming saving is the other side of the giro's; only the giro's leg counts.
    expect(await insights.monthFigures(max, { ownPrivate: true })).toEqual({
      ok: true,
      month: "2026-10",
      incomeCents: 200000,
      expenseCents: -25000,
      savingCents: -25000,
      contributionCents: -80000,
      availableCents: 70000,
    });
  });

  it("keeps all saving bookings of a savings account on its own", async () => {
    expect(await insights.monthFigures(max, "max-tr")).toMatchObject({ ok: true, savingCents: 25000 });
  });

  it("never gives another member's private account, nor the shared account to another household", async () => {
    expect(await insights.monthFigures(erika, "max-giro")).toEqual({ ok: false, reason: "not-found" });
    expect(await insights.monthFigures(dora, "shared")).toEqual({ ok: false, reason: "not-found" });
    expect(await insights.monthFigures(erika, "shared")).toMatchObject({ ok: true, expenseCents: -12000 });
  });

  it("never mixes members in Alle privaten Konten", async () => {
    expect(await insights.monthFigures(erika, { ownPrivate: true })).toMatchObject({
      incomeCents: 300000,
      expenseCents: -99900,
      contributionCents: 0,
    });
    expect(await insights.monthFigures(dora, { ownPrivate: true })).toMatchObject({ incomeCents: 50000, contributionCents: 0 });
  });
});

describe("statistics", () => {
  it("gives the rows newest first, the comparison with the previous month and the bar scale", async () => {
    const result = await insights.statistics(max, "max-giro", 3);
    expect(result).toEqual({
      ok: true,
      rows: [
        { month: "2026-10", incomeCents: 200000, expenseCents: -25000, savingCents: -25000, availableCents: 150000, contributionCents: null, savingsRate: 0.125 },
        { month: "2026-09", incomeCents: 100000, expenseCents: -40000, savingCents: 0, availableCents: 60000, contributionCents: null, savingsRate: 0 },
        { month: "2026-08", incomeCents: 0, expenseCents: 0, savingCents: 0, availableCents: 0, contributionCents: null, savingsRate: null },
      ],
      // 150 € less spent than in September.
      comparison: { expenseChangeCents: -15000, savingsRateChangePoints: 12.5 },
      scaleCents: 200000,
    });
  });

  it("adds each month's contribution for Alle privaten Konten", async () => {
    const result = await insights.statistics(max, { ownPrivate: true }, 2);
    expect(result.ok && result.rows.map((r) => [r.month, r.contributionCents, r.availableCents])).toEqual([
      ["2026-10", -80000, 70000],
      ["2026-09", 0, 60000],
    ]);
  });

  it("has no comparison for a single month", async () => {
    expect(await insights.statistics(max, "max-giro", 1)).toMatchObject({ ok: true, comparison: null });
  });

  it("never gives another member's private account, and never mixes members", async () => {
    expect(await insights.statistics(erika, "max-giro", 12)).toEqual({ ok: false, reason: "not-found" });
    expect(await insights.statistics(dora, "shared", 12)).toEqual({ ok: false, reason: "not-found" });
    const erikas = await insights.statistics(erika, { ownPrivate: true }, 2);
    expect(erikas.ok && erikas.rows.map((r) => [r.incomeCents, r.expenseCents, r.contributionCents])).toEqual([
      [300000, -99900, 0],
      [0, 0, 0],
    ]);
  });

  it("rejects an invalid number of months", async () => {
    expect(await insights.statistics(max, "max-giro", 0)).toEqual({ ok: false, reason: "invalid-input" });
    expect(await insights.statistics(max, "max-giro", 25)).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("gives the months up to a chosen month, compared with the month before it", async () => {
    const result = await insights.statistics(max, "max-giro", 2, "2026-09");
    expect(result.ok && result.rows.map((r) => [r.month, r.incomeCents])).toEqual([
      ["2026-09", 100000],
      ["2026-08", 0],
    ]);
    expect(result.ok && result.comparison).toEqual({ expenseChangeCents: 40000, savingsRateChangePoints: null });
  });

  it("rejects a chosen month after the current one or a malformed one", async () => {
    expect(await insights.statistics(max, "max-giro", 12, "2026-11")).toEqual({ ok: false, reason: "invalid-input" });
    expect(await insights.statistics(max, "max-giro", 12, "2026-13")).toEqual({ ok: false, reason: "invalid-input" });
    expect(await insights.statistics(max, "max-giro", 12, "2026-9")).toEqual({ ok: false, reason: "invalid-input" });
  });
});

describe("category trends", () => {
  it("gives one account's 12-month trend and its averages over complete months", async () => {
    const result = await insights.categoryTrends(max, "max-giro");
    expect(result.ok && result.months).toHaveLength(12);
    expect(result.ok && [result.months[0], result.months.at(-1)]).toEqual(["2025-11", "2026-10"]);
    // Leisure: 400 € in September only. Groceries: 300 € minus a 50 € refund, this month only.
    expect(result.ok && result.groups).toEqual([
      {
        group: "groceries",
        trend: [...Array(11).fill(0), 25000],
        average3Cents: 0,
        average6Cents: 0,
        average12Cents: 0,
        difference: { direction: "more", cents: 25000 },
      },
      {
        group: "leisure",
        trend: [...Array(10).fill(0), 40000, 0],
        average3Cents: 13333,
        average6Cents: 6667,
        average12Cents: 3333,
        difference: { direction: "less", cents: -13333 },
      },
    ]);
  });

  it("gives the trend up to a chosen month, compared with the 3 months before it", async () => {
    const result = await insights.categoryTrends(max, "max-giro", "2026-09");
    expect(result.ok && [result.months[0], result.months.at(-1)]).toEqual(["2025-10", "2026-09"]);
    expect(result.ok && result.groups.map((g) => [g.group, g.trend.at(-1), g.difference.direction])).toEqual([["leisure", 40000, "more"]]);
    expect(await insights.categoryTrends(max, "max-giro", "2026-11")).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("covers all own private accounts for Alle privaten Konten, never another member's or shared spending", async () => {
    const maxs = await insights.categoryTrends(max, { ownPrivate: true });
    expect(maxs.ok && maxs.groups.map((g) => g.group)).toEqual(["groceries", "leisure"]);
    const erikas = await insights.categoryTrends(erika, { ownPrivate: true });
    expect(erikas.ok && erikas.groups.map((g) => [g.group, g.trend.at(-1)])).toEqual([["shopping", 99900]]);
    expect(await insights.categoryTrends(dora, { ownPrivate: true })).toMatchObject({ ok: true, groups: [] });
  });

  it("never gives another member's private account, nor the shared account to another household", async () => {
    expect(await insights.categoryTrends(erika, "max-giro")).toEqual({ ok: false, reason: "not-found" });
    expect(await insights.categoryTrends(dora, "shared")).toEqual({ ok: false, reason: "not-found" });
    const shared = await insights.categoryTrends(max, "shared");
    expect(shared.ok && shared.groups.map((g) => [g.group, g.trend.at(-1)])).toEqual([["housing", 12000]]);
  });
});

describe("year overview", () => {
  it("gives one account's year up to the current month, January first, with totals and categories", async () => {
    const result = await insights.yearOverview(max, "max-giro", 2026);
    expect(result.ok && result.months.map((m) => m.month)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(result.ok && result.months.at(-1)).toMatchObject({ incomeCents: 200000, expenseCents: -25000, contributionCents: null });
    expect(result).toMatchObject({
      ok: true,
      year: 2026,
      totals: { incomeCents: 300000, expenseCents: -65000, savingCents: -25000, contributionCents: null, availableCents: 210000 },
      // Groceries: 300 € minus a 50 € refund.
      categories: { totalCents: 65000, groups: [{ group: "leisure", cents: 40000 }, { group: "groceries", cents: 25000 }] },
    });
    expect(result.ok && result.totals.savingsRate).toBeCloseTo(25000 / 300000);
  });

  it("gives all 12 months of a past year", async () => {
    const result = await insights.yearOverview(max, "max-giro", 2025);
    expect(result.ok && result.months.map((m) => m.month)).toEqual(Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`));
    expect(result).toMatchObject({ ok: true, totals: { incomeCents: 0, savingsRate: null }, categories: { totalCents: 0, groups: [] } });
  });

  it("adds the contribution to shared accounts for Alle privaten Konten", async () => {
    expect(await insights.yearOverview(max, { ownPrivate: true }, 2026)).toMatchObject({
      ok: true,
      totals: { incomeCents: 300000, expenseCents: -65000, savingCents: -25000, contributionCents: -80000, availableCents: 130000 },
    });
    const overview = await insights.yearOverview(max, { ownPrivate: true }, 2026);
    expect(overview.ok && overview.totals.savingsRate).toBeCloseTo(25000 / 300000);
  });

  it("rejects a future year or an invalid one", async () => {
    for (const year of [2027, 1969, 2026.5]) {
      expect(await insights.yearOverview(max, "max-giro", year)).toEqual({ ok: false, reason: "invalid-input" });
    }
  });

  it("never gives another member's private account, and never mixes members", async () => {
    expect(await insights.yearOverview(erika, "max-giro", 2026)).toEqual({ ok: false, reason: "not-found" });
    expect(await insights.yearOverview(dora, "shared", 2026)).toEqual({ ok: false, reason: "not-found" });
    expect(await insights.yearOverview(erika, { ownPrivate: true }, 2026)).toMatchObject({
      totals: { incomeCents: 300000, expenseCents: -99900, contributionCents: 0 },
      categories: { groups: [{ group: "shopping", cents: 99900 }] },
    });
    expect(await insights.yearOverview(dora, { ownPrivate: true }, 2026)).toMatchObject({ totals: { incomeCents: 50000, expenseCents: 0 } });
  });
});

describe("balances", () => {
  const accounts = [
    { id: "max-giro", openingBalanceCents: 10000 },
    { id: "shared", openingBalanceCents: 0 },
  ];

  it("adds each given account's bookings to its opening balance", async () => {
    expect(await insights.balances(max, accounts)).toEqual({ "max-giro": 10000 + 200000 - 30000 + 5000 - 25000 - 80000 + 100000 - 40000, shared: 68000 });
  });

  it("never counts bookings of an account the caller may not see", async () => {
    // Erika passes Max's account id: his bookings are invisible to her, so only the opening balance remains.
    expect(await insights.balances(erika, accounts)).toEqual({ "max-giro": 10000, shared: 68000 });
    expect(await insights.balances(dora, [{ id: "shared", openingBalanceCents: 0 }])).toEqual({ shared: 0 });
  });
});
