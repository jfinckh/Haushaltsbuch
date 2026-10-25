import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withSession, type Caller } from "@/shared/rls";
import { createCategories } from "./create-categories";
import { createTransactions, type TransactionView } from "./create-transactions";
import type { TransactionValues } from "./validation";
import { transaction } from "./schema";
import { createTestDatabase } from "./test-utils";

type Setup = Awaited<ReturnType<typeof createTestDatabase>>;

let setup: Setup;
let transactions: ReturnType<typeof createTransactions>;
let max: Caller;
let erika: Caller;
let dora: Caller;

const IBAN = "DE89370400440532013000";

const input = (overrides: Record<string, unknown> = {}) => ({
  accountId: "max-private",
  date: "2026-10-08",
  amount: "-3,50",
  kind: "expense",
  category: "groceries.supermarket",
  counterparty: "Bäckerei Müller",
  counterpartyIban: IBAN,
  reference: "Brötchen",
  ...overrides,
});

async function create(caller: Caller, overrides: Record<string, unknown> = {}): Promise<TransactionView> {
  const result = await transactions.createTransaction(caller, input(overrides));
  if (!result.ok) throw new Error(`create failed: ${result.reason}`);
  return result.transaction;
}

async function list(caller: Caller, query: Record<string, unknown>) {
  const result = await transactions.listTransactions(caller, query);
  if (!result.ok) throw new Error(`list failed: ${result.reason}`);
  return result.transactions;
}

async function storedRow(id: string) {
  const [row] = await setup.db.select().from(transaction).where(eq(transaction.id, id));
  return row;
}

beforeEach(async () => {
  setup = await createTestDatabase();
  transactions = createTransactions({ db: setup.db, crypto: setup.crypto, today: () => "2026-10-21" });
  await setup.householdOf("home", "max", "erika");
  await setup.householdOf("other", "dora");
  await setup.addAccount("max-private", "max", null, 10000);
  await setup.addAccount("home-shared", "max", "home");
  await setup.addAccount("dora-shared", "dora", "other");
  [max, erika, dora] = await Promise.all([setup.as("max"), setup.as("erika"), setup.as("dora")]);
});

describe("creating bookings", () => {
  it("returns the new booking with its texts", async () => {
    const booking = await create(max);
    expect(booking).toMatchObject({
      accountId: "max-private",
      date: "2026-10-08",
      amountCents: -350,
      kind: "expense",
      category: "groceries.supermarket",
      counterparty: "Bäckerei Müller",
      counterpartyIban: "DE89 3704 0044 0532 0130 00",
      reference: "Brötchen",
      createdByMe: true,
    });
  });

  it("stores names, IBAN and reference encrypted, with a blind index for the IBAN", async () => {
    const booking = await create(max);
    const row = await storedRow(booking.id);
    const raw = JSON.stringify(row);
    expect(raw).not.toContain("Bäckerei");
    expect(raw).not.toContain(IBAN);
    expect(raw).not.toContain("Brötchen");
    expect(row.counterpartyIbanIndex).toBe(setup.crypto.blindIndex(IBAN, "transaction.counterpartyIban"));
    expect(row.createdByUserId).toBe("max");
  });

  it("rejects invalid input", async () => {
    expect(await transactions.createTransaction(max, input({ amount: "0" }))).toEqual({ ok: false, reason: "invalid-input" });
    expect(await transactions.createTransaction(max, null)).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("treats an account the caller cannot see like an unknown one", async () => {
    expect(await transactions.createTransaction(erika, input())).toEqual({ ok: false, reason: "not-found" });
    expect(await transactions.createTransaction(erika, input({ accountId: "dora-shared" }))).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await transactions.createTransaction(max, input({ accountId: "nope" }))).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("listing bookings", () => {
  beforeEach(async () => {
    await create(max, { date: "2026-10-01", amount: "-50,00", counterparty: "REWE Markt", reference: "Einkauf" });
    await create(max, { date: "2026-10-15", amount: "3.250,00", kind: "income", category: "salary", counterparty: "Arbeitgeber GmbH", reference: "Gehalt Oktober" });
    await create(max, { date: "2026-10-10", amount: "-9,99", category: "contracts.subscriptions", counterparty: "PayPal", reference: "Spotify Premium" });
    await create(max, { date: "2026-09-30", amount: "-900,00", kind: "transfer", category: "", counterparty: null, reference: "Trade Republic" });
    await create(max, { accountId: "home-shared", date: "2026-10-02" });
  });

  it("lists one account's bookings of the current month, newest first", async () => {
    const rows = await list(max, { accountId: "max-private" });
    expect(rows.map((r) => r.date)).toEqual(["2026-10-15", "2026-10-10", "2026-10-01"]);
  });

  it("lists a chosen calendar month", async () => {
    const rows = await list(max, { accountId: "max-private", month: "2026-09" });
    expect(rows.map((r) => r.date)).toEqual(["2026-09-30"]);
    expect(await transactions.listTransactions(max, { accountId: "max-private", month: "2026-13" })).toEqual({
      ok: false,
      reason: "invalid-input",
    });
  });

  it("lists a chosen range", async () => {
    const rows = await list(max, { accountId: "max-private", from: "2026-09-01", to: "2026-09-30" });
    expect(rows.map((r) => r.amountCents)).toEqual([-90000]);
  });

  it("filters by type and by category, a group including its subcategories", async () => {
    expect((await list(max, { accountId: "max-private", kind: "income" })).map((r) => r.category)).toEqual(["salary"]);
    expect((await list(max, { accountId: "max-private", category: "contracts" })).map((r) => r.category)).toEqual([
      "contracts.subscriptions",
    ]);
  });

  it("searches counterparty and reference, ignoring case, within the range", async () => {
    expect((await list(max, { accountId: "max-private", q: "spotify" })).map((r) => r.date)).toEqual(["2026-10-10"]);
    expect((await list(max, { accountId: "max-private", q: "rewe" })).map((r) => r.date)).toEqual(["2026-10-01"]);
    expect(await list(max, { accountId: "max-private", q: "trade republic" })).toEqual([]);
  });

  it("rejects invalid queries", async () => {
    expect(await transactions.listTransactions(max, {})).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("never lists another member's private account, as if it did not exist", async () => {
    expect(await transactions.listTransactions(erika, { accountId: "max-private" })).toEqual({ ok: false, reason: "not-found" });
    expect(await transactions.listTransactions(dora, { accountId: "home-shared" })).toEqual({ ok: false, reason: "not-found" });
  });

  it("shows shared accounts' bookings to every member, marking who created them", async () => {
    const [shared] = await list(erika, { accountId: "home-shared" });
    expect(shared).toMatchObject({ accountId: "home-shared", createdByMe: false });
  });
});

describe("reading, changing and deleting one booking", () => {
  it("gets a visible booking, and null for another member's private one", async () => {
    const booking = await create(max);
    expect(await transactions.getTransaction(max, booking.id)).toEqual(booking);
    expect(await transactions.getTransaction(erika, booking.id)).toBeNull();
    expect(await transactions.getTransaction(max, "nope")).toBeNull();
  });

  it("changes the given fields only", async () => {
    const booking = await create(max);
    const result = await transactions.updateTransaction(max, booking.id, { amount: "-4,20", reference: "" });
    expect(result).toEqual({ ok: true, transaction: { ...booking, amountCents: -420, reference: null } });
  });

  it("drops a category that no longer fits a new type", async () => {
    const booking = await create(max);
    const result = await transactions.updateTransaction(max, booking.id, { kind: "transfer" });
    expect(result.ok && result.transaction).toMatchObject({ kind: "transfer", category: null });
  });

  it("rejects an invalid change", async () => {
    const booking = await create(max);
    expect(await transactions.updateTransaction(max, booking.id, { kind: "income", category: "groceries" })).toEqual({
      ok: false,
      reason: "invalid-input",
    });
  });

  it("lets every member change a shared account's booking", async () => {
    const booking = await create(max, { accountId: "home-shared" });
    const result = await transactions.updateTransaction(erika, booking.id, { amount: "-5,00" });
    expect(result.ok && result.transaction.amountCents).toBe(-500);
  });

  it("never changes another member's private booking, and leaves it as it was", async () => {
    const booking = await create(max);
    expect(await transactions.updateTransaction(erika, booking.id, { amount: "-1,00" })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect((await storedRow(booking.id)).amountCents).toBe(-350);
  });

  it("never moves a booking into an account the caller cannot see", async () => {
    const booking = await create(erika, { accountId: "home-shared" });
    expect(await transactions.updateTransaction(erika, booking.id, { accountId: "max-private" })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect((await storedRow(booking.id)).accountId).toBe("home-shared");
  });

  it("deletes a visible booking, but never another member's private one", async () => {
    const mine = await create(max);
    expect(await transactions.deleteTransaction(erika, mine.id)).toBe(false);
    expect(await storedRow(mine.id)).toBeDefined();
    expect(await transactions.deleteTransaction(max, mine.id)).toBe(true);
    expect(await storedRow(mine.id)).toBeUndefined();
  });
});

describe("balances", () => {
  it("sums each visible account's bookings, and nothing of invisible accounts", async () => {
    await create(max, { amount: "-3,50" });
    await create(max, { amount: "50,00", kind: "income", category: "salary" });
    await create(max, { accountId: "home-shared", amount: "-20,00" });
    await create(dora, { accountId: "dora-shared", amount: "-1,00" });

    // Only the bookings; the app adds the opening balance.
    expect(await transactions.balances(max)).toEqual({ "max-private": 4650, "home-shared": -2000 });
    expect(await transactions.balances(erika)).toEqual({ "home-shared": -2000 });
    expect(await transactions.balances(dora)).toEqual({ "dora-shared": -100 });
  });
});

describe("month summary of one account (dashboard)", () => {
  it("sums income, expenses and saving of the month; available is their sum, transfers never count", async () => {
    await create(max, { date: "2026-10-01", amount: "2.000,00", kind: "income", category: "salary" });
    await create(max, { date: "2026-10-02", amount: "-300,00", category: "groceries" });
    await create(max, { date: "2026-10-03", amount: "20,00", category: "groceries" });
    await create(max, { date: "2026-10-04", amount: "-15,00", category: null });
    await create(max, { date: "2026-10-05", amount: "-250,00", kind: "saving", category: null });
    await create(max, { date: "2026-10-06", amount: "-500,00", kind: "transfer", category: null });
    await create(max, { date: "2026-09-30", amount: "-99,00", category: "groceries" });
    await create(max, { date: "2026-11-01", amount: "-99,00", category: "groceries" });

    expect(await transactions.monthSummary(max, "max-private", "2026-10")).toEqual({
      ok: true,
      month: "2026-10",
      incomeCents: 200000,
      expenseCents: -29500,
      savingCents: -25000,
      availableCents: 145500,
    });
  });

  it("uses the current month without a month, and zeros without bookings", async () => {
    expect(await transactions.monthSummary(max, "max-private")).toEqual({
      ok: true,
      month: "2026-10",
      incomeCents: 0,
      expenseCents: 0,
      savingCents: 0,
      availableCents: 0,
    });
  });

  it("never sums another member's private account, as if it did not exist", async () => {
    await create(max, { date: "2026-10-08", amount: "-4,00" });
    expect(await transactions.monthSummary(erika, "max-private")).toEqual({ ok: false, reason: "not-found" });
    expect(await transactions.monthSummary(dora, "home-shared")).toEqual({ ok: false, reason: "not-found" });
    expect(await transactions.monthSummary(max, "unknown")).toEqual({ ok: false, reason: "not-found" });
  });

  it("gives every member the same figures of a shared account", async () => {
    await create(max, { accountId: "home-shared", date: "2026-10-08", amount: "-4,00" });
    const ofMax = await transactions.monthSummary(max, "home-shared");
    expect(ofMax).toMatchObject({ ok: true, expenseCents: -400, availableCents: -400 });
    expect(await transactions.monthSummary(erika, "home-shared")).toEqual(ofMax);
  });

  it("rejects an invalid month", async () => {
    expect(await transactions.monthSummary(max, "max-private", "2026-13")).toEqual({ ok: false, reason: "invalid-input" });
  });
});

describe("month summaries over a series of months (statistics)", () => {
  const OWN = { ownPrivate: true } as const;
  const zero = (month: string) => ({ month, incomeCents: 0, expenseCents: 0, savingCents: 0, availableCents: 0 });

  it("gives each month of the series newest first, with the same figures as the month summary", async () => {
    await create(max, { date: "2026-10-01", amount: "2.000,00", kind: "income", category: "salary" });
    await create(max, { date: "2026-10-02", amount: "-300,00", category: "groceries" });
    await create(max, { date: "2026-10-03", amount: "20,00", category: "groceries" });
    await create(max, { date: "2026-10-05", amount: "-250,00", kind: "saving", category: null });
    await create(max, { date: "2026-10-06", amount: "-500,00", kind: "transfer", category: null });
    await create(max, { date: "2026-08-31", amount: "-99,00", category: "groceries" });
    await create(max, { date: "2026-07-31", amount: "-11,00", category: "groceries" });
    await create(max, { date: "2026-11-01", amount: "-11,00", category: "groceries" });

    const result = await transactions.monthSummaries(max, "max-private", 3, "2026-10");
    expect(result).toEqual({
      ok: true,
      months: [
        { month: "2026-10", incomeCents: 200000, expenseCents: -28000, savingCents: -25000, availableCents: 147000 },
        zero("2026-09"),
        { ...zero("2026-08"), expenseCents: -9900, availableCents: -9900 },
      ],
    });
    const { ok, ...october } = (await transactions.monthSummary(max, "max-private", "2026-10")) as { ok: true };
    expect(ok).toBe(true);
    expect(result.ok && result.months[0]).toEqual(october);
  });

  it("ends with the current month by default and crosses the year boundary", async () => {
    await create(max, { date: "2025-12-24", amount: "-40,00", category: "shopping" });
    const byDefault = await transactions.monthSummaries(max, "max-private", 2);
    expect(byDefault.ok && byDefault.months.map((m) => m.month)).toEqual(["2026-10", "2026-09"]);
    const overNewYear = await transactions.monthSummaries(max, "max-private", 3, "2026-01");
    expect(overNewYear.ok && overNewYear.months.map((m) => [m.month, m.expenseCents])).toEqual([
      ["2026-01", 0],
      ["2025-12", -4000],
      ["2025-11", 0],
    ]);
  });

  it("sums all own private accounts per month, never shared ones or another member's", async () => {
    await setup.addAccount("max-tr", "max");
    await setup.addAccount("erika-private", "erika");
    await create(max, { date: "2026-10-01", amount: "1.000,00", kind: "income", category: "salary" });
    await create(max, { accountId: "max-tr", date: "2026-09-04", amount: "-250,00", kind: "saving", category: null });
    await create(max, { accountId: "home-shared", date: "2026-10-07", amount: "-70,00", category: "housing" });
    await create(erika, { accountId: "erika-private", date: "2026-09-08", amount: "-40,00", category: "shopping" });

    expect(await transactions.monthSummaries(max, OWN, 2, "2026-10")).toEqual({
      ok: true,
      months: [
        { ...zero("2026-10"), incomeCents: 100000, availableCents: 100000 },
        { ...zero("2026-09"), savingCents: -25000, availableCents: -25000 },
      ],
    });
    expect(await transactions.monthSummaries(erika, OWN, 2, "2026-10")).toEqual({
      ok: true,
      months: [zero("2026-10"), { ...zero("2026-09"), expenseCents: -4000, availableCents: -4000 }],
    });
    expect(await transactions.monthSummaries(dora, OWN, 1)).toEqual({ ok: true, months: [zero("2026-10")] });
  });

  it("counts saving into an own savings account once for the own private accounts", async () => {
    await setup.addAccount("max-savings", "max");
    await setup.db.execute(sql`UPDATE account SET role = 'savings' WHERE id = 'max-savings'`);
    // Both sides of a linked everyday → savings transfer are of kind saving; only the everyday one counts.
    await create(max, { date: "2026-10-05", amount: "-100,00", kind: "saving", category: null });
    await create(max, { accountId: "max-savings", date: "2026-10-05", amount: "100,00", kind: "saving", category: null });

    expect(await transactions.monthSummary(max, OWN, "2026-10")).toEqual({
      ok: true,
      ...zero("2026-10"),
      savingCents: -10000,
      availableCents: -10000,
    });
    // The savings account on its own keeps all its bookings.
    expect(await transactions.monthSummary(max, "max-savings", "2026-10")).toMatchObject({ ok: true, savingCents: 10000 });
  });

  it("never sums another member's private account, as if it did not exist", async () => {
    await create(max, { date: "2026-10-08", amount: "-4,00" });
    expect(await transactions.monthSummaries(erika, "max-private", 12)).toEqual({ ok: false, reason: "not-found" });
    expect(await transactions.monthSummaries(dora, "home-shared", 12)).toEqual({ ok: false, reason: "not-found" });
  });

  it("rejects an invalid count or month", async () => {
    for (const count of [0, 25, 1.5]) {
      expect(await transactions.monthSummaries(max, "max-private", count)).toEqual({ ok: false, reason: "invalid-input" });
    }
    expect(await transactions.monthSummaries(max, "max-private", 12, "2026-13")).toEqual({ ok: false, reason: "invalid-input" });
  });
});

describe("spending by category of one account (dashboard)", () => {
  it("sums only the month's expenses per group; refunds lower them, uncategorized is its own row", async () => {
    await create(max, { date: "2026-10-01", amount: "-50,00", category: "groceries.supermarket" });
    await create(max, { date: "2026-10-02", amount: "-10,00", category: "groceries" });
    await create(max, { date: "2026-10-03", amount: "-40,00", category: "housing.rent" });
    await create(max, { date: "2026-10-04", amount: "40,00", category: "housing" });
    await create(max, { date: "2026-10-05", amount: "-15,00", category: null });
    await create(max, { date: "2026-10-06", amount: "2.000,00", kind: "income", category: "salary" });
    await create(max, { date: "2026-10-07", amount: "-250,00", kind: "saving", category: null });
    await create(max, { date: "2026-10-08", amount: "-500,00", kind: "transfer", category: null });
    await create(max, { date: "2026-09-30", amount: "-99,00", category: "groceries" });
    await create(max, { date: "2026-11-01", amount: "-99,00", category: "groceries" });

    expect(await transactions.categorySpending(max, "max-private", "2026-10")).toEqual({
      ok: true,
      month: "2026-10",
      totalCents: 7500,
      groups: [
        { group: "groceries", cents: 6000 },
        { group: null, cents: 1500 },
      ],
    });
  });

  it("uses the current month without a month, and has no rows without expenses", async () => {
    await create(max, { date: "2026-09-30", amount: "-99,00", category: "groceries" });
    expect(await transactions.categorySpending(max, "max-private")).toEqual({ ok: true, month: "2026-10", totalCents: 0, groups: [] });
  });

  it("never sums another member's private account, as if it did not exist", async () => {
    await create(max, { date: "2026-10-08", amount: "-4,00" });
    expect(await transactions.categorySpending(erika, "max-private")).toEqual({ ok: false, reason: "not-found" });
    expect(await transactions.categorySpending(dora, "home-shared")).toEqual({ ok: false, reason: "not-found" });
    expect(await transactions.categorySpending(max, "unknown")).toEqual({ ok: false, reason: "not-found" });
  });

  it("gives every member the same figures of a shared account", async () => {
    await create(max, { accountId: "home-shared", date: "2026-10-08", amount: "-4,00" });
    const ofMax = await transactions.categorySpending(max, "home-shared");
    expect(ofMax).toMatchObject({ ok: true, totalCents: 400, groups: [{ group: "groceries", cents: 400 }] });
    expect(await transactions.categorySpending(erika, "home-shared")).toEqual(ofMax);
  });

  it("rejects an invalid month", async () => {
    expect(await transactions.categorySpending(max, "max-private", "2026-13")).toEqual({ ok: false, reason: "invalid-input" });
  });
});

describe("spending by category over a series of months (statistics)", () => {
  const OWN = { ownPrivate: true } as const;
  const empty = (month: string) => ({ month, totalCents: 0, groups: [] });

  it("gives each month newest first, with the same figures as the month's category spending", async () => {
    await create(max, { date: "2026-10-01", amount: "-50,00", category: "groceries.supermarket" });
    await create(max, { date: "2026-10-04", amount: "20,00", category: "groceries" });
    await create(max, { date: "2026-10-05", amount: "-15,00", category: null });
    await create(max, { date: "2026-10-06", amount: "2.000,00", kind: "income", category: "salary" });
    await create(max, { date: "2026-10-07", amount: "-250,00", kind: "saving", category: null });
    await create(max, { date: "2026-10-08", amount: "-500,00", kind: "transfer", category: null });
    await create(max, { date: "2026-08-03", amount: "-40,00", category: "housing.rent" });
    await create(max, { date: "2026-08-04", amount: "60,00", category: "housing" });
    await create(max, { date: "2026-08-31", amount: "-12,00", category: "leisure" });
    await create(max, { date: "2026-07-31", amount: "-11,00", category: "groceries" });
    await create(max, { date: "2026-11-01", amount: "-11,00", category: "groceries" });

    const result = await transactions.categorySpendings(max, "max-private", 3, "2026-10");
    expect(result).toEqual({
      ok: true,
      months: [
        {
          month: "2026-10",
          totalCents: 4500,
          groups: [
            { group: "groceries", cents: 3000 },
            { group: null, cents: 1500 },
          ],
        },
        empty("2026-09"),
        // The refund larger than the purchase leaves shopping out, as on the dashboard.
        { month: "2026-08", totalCents: 1200, groups: [{ group: "leisure", cents: 1200 }] },
      ],
    });
    for (const month of result.ok ? result.months : []) {
      const { ok, ...single } = (await transactions.categorySpending(max, "max-private", month.month)) as { ok: true };
      expect(ok).toBe(true);
      expect(single).toEqual(month);
    }
  });

  it("ends with the current month by default and crosses the year boundary", async () => {
    await create(max, { date: "2025-12-24", amount: "-40,00", category: "shopping" });
    const byDefault = await transactions.categorySpendings(max, "max-private", 2);
    expect(byDefault.ok && byDefault.months.map((m) => m.month)).toEqual(["2026-10", "2026-09"]);
    const overNewYear = await transactions.categorySpendings(max, "max-private", 3, "2026-01");
    expect(overNewYear.ok && overNewYear.months.map((m) => [m.month, m.totalCents])).toEqual([
      ["2026-01", 0],
      ["2025-12", 4000],
      ["2025-11", 0],
    ]);
  });

  it("sums all own private accounts per month, never shared ones or another member's", async () => {
    await setup.addAccount("max-tr", "max");
    await setup.addAccount("erika-private", "erika");
    await create(max, { date: "2026-10-01", amount: "-10,00", category: "groceries" });
    await create(max, { accountId: "max-tr", date: "2026-09-04", amount: "-25,00", category: "leisure" });
    await create(max, { accountId: "home-shared", date: "2026-10-07", amount: "-70,00", category: "housing" });
    await create(erika, { accountId: "erika-private", date: "2026-09-08", amount: "-40,00", category: "shopping" });

    expect(await transactions.categorySpendings(max, OWN, 2, "2026-10")).toEqual({
      ok: true,
      months: [
        { month: "2026-10", totalCents: 1000, groups: [{ group: "groceries", cents: 1000 }] },
        { month: "2026-09", totalCents: 2500, groups: [{ group: "leisure", cents: 2500 }] },
      ],
    });
    expect(await transactions.categorySpendings(erika, OWN, 2, "2026-10")).toEqual({
      ok: true,
      months: [empty("2026-10"), { month: "2026-09", totalCents: 4000, groups: [{ group: "shopping", cents: 4000 }] }],
    });
    expect(await transactions.categorySpendings(dora, OWN, 1)).toEqual({ ok: true, months: [empty("2026-10")] });
  });

  it("never sums another member's private account, as if it did not exist", async () => {
    await create(max, { date: "2026-10-08", amount: "-4,00" });
    expect(await transactions.categorySpendings(erika, "max-private", 12)).toEqual({ ok: false, reason: "not-found" });
    expect(await transactions.categorySpendings(dora, "home-shared", 12)).toEqual({ ok: false, reason: "not-found" });
  });

  it("rejects an invalid count or month", async () => {
    for (const count of [0, 25, 1.5]) {
      expect(await transactions.categorySpendings(max, "max-private", count)).toEqual({ ok: false, reason: "invalid-input" });
    }
    expect(await transactions.categorySpendings(max, "max-private", 12, "2026-13")).toEqual({ ok: false, reason: "invalid-input" });
  });
});

describe("latest bookings of one account (dashboard)", () => {
  beforeEach(async () => {
    await create(max, { date: "2026-08-01", amount: "-1,00" });
    await create(max, { date: "2026-10-01", amount: "-2,00" });
    await create(max, { date: "2026-09-15", amount: "-3,00" });
    await create(max, { accountId: "home-shared", date: "2026-10-02" });
  });

  it("lists the newest bookings across months, up to the limit", async () => {
    const result = await transactions.latestTransactions(max, "max-private", 2);
    expect(result.ok && result.transactions.map((t) => t.date)).toEqual(["2026-10-01", "2026-09-15"]);
  });

  it("never lists another member's private account, as if it did not exist", async () => {
    expect(await transactions.latestTransactions(erika, "max-private", 8)).toEqual({ ok: false, reason: "not-found" });
    expect(await transactions.latestTransactions(dora, "home-shared", 8)).toEqual({ ok: false, reason: "not-found" });
    const shared = await transactions.latestTransactions(erika, "home-shared", 8);
    expect(shared.ok && shared.transactions.map((t) => t.accountId)).toEqual(["home-shared"]);
  });

  it("rejects a limit outside 1 to 50", async () => {
    expect(await transactions.latestTransactions(max, "max-private", 0)).toEqual({ ok: false, reason: "invalid-input" });
    expect(await transactions.latestTransactions(max, "max-private", 51)).toEqual({ ok: false, reason: "invalid-input" });
  });
});

describe("all of the caller's own private accounts together (dashboard)", () => {
  const OWN = { ownPrivate: true } as const;

  beforeEach(async () => {
    await setup.addAccount("max-tr", "max");
    await setup.addAccount("erika-private", "erika");
    await create(max, { date: "2026-10-01", amount: "2.000,00", kind: "income", category: "salary" });
    await create(max, { date: "2026-10-02", amount: "-30,00", category: "groceries" });
    await create(max, { accountId: "max-tr", date: "2026-10-03", amount: "-20,00", category: "groceries.supermarket" });
    await create(max, { accountId: "max-tr", date: "2026-10-04", amount: "-250,00", kind: "saving", category: null });
    await create(max, { date: "2026-10-05", amount: "-500,00", kind: "transfer", category: null });
    await create(max, { accountId: "max-tr", date: "2026-10-06", amount: "500,00", kind: "transfer", category: null });
    await create(max, { accountId: "max-tr", date: "2026-09-30", amount: "-99,00", category: "groceries" });
    await create(max, { accountId: "home-shared", date: "2026-10-07", amount: "-70,00", category: "housing" });
    await create(erika, { accountId: "erika-private", date: "2026-10-08", amount: "-40,00", category: "shopping" });
    await create(erika, { accountId: "erika-private", date: "2026-10-09", amount: "900,00", kind: "income", category: "salary" });
  });

  it("sums the month over all own private accounts; shared accounts and transfers never count", async () => {
    expect(await transactions.monthSummary(max, OWN, "2026-10")).toEqual({
      ok: true,
      month: "2026-10",
      incomeCents: 200000,
      expenseCents: -5000,
      savingCents: -25000,
      availableCents: 170000,
    });
  });

  it("sums the spending by category over all own private accounts", async () => {
    expect(await transactions.categorySpending(max, OWN, "2026-10")).toEqual({
      ok: true,
      month: "2026-10",
      totalCents: 5000,
      groups: [{ group: "groceries", cents: 5000 }],
    });
  });

  it("lists the newest bookings of all own private accounts only", async () => {
    const result = await transactions.latestTransactions(max, OWN, 3);
    expect(result.ok && result.transactions.map((t) => [t.date, t.accountId])).toEqual([
      ["2026-10-06", "max-tr"],
      ["2026-10-05", "max-private"],
      ["2026-10-04", "max-tr"],
    ]);
    const all = await transactions.latestTransactions(max, OWN, 50);
    expect(all.ok && new Set(all.transactions.map((t) => t.accountId))).toEqual(new Set(["max-private", "max-tr"]));
  });

  it("never mixes in another member's private accounts, either way", async () => {
    expect(await transactions.monthSummary(erika, OWN, "2026-10")).toMatchObject({ incomeCents: 90000, expenseCents: -4000, savingCents: 0 });
    expect(await transactions.categorySpending(erika, OWN, "2026-10")).toMatchObject({ groups: [{ group: "shopping", cents: 4000 }] });
    const latest = await transactions.latestTransactions(erika, OWN, 50);
    expect(latest.ok && latest.transactions.map((t) => t.accountId)).toEqual(["erika-private", "erika-private"]);
  });

  it("gives zeros to a member without private accounts", async () => {
    expect(await transactions.monthSummary(dora, OWN)).toEqual({
      ok: true,
      month: "2026-10",
      incomeCents: 0,
      expenseCents: 0,
      savingCents: 0,
      availableCents: 0,
    });
    expect(await transactions.categorySpending(dora, OWN)).toEqual({ ok: true, month: "2026-10", totalCents: 0, groups: [] });
    expect(await transactions.latestTransactions(dora, OWN, 8)).toEqual({ ok: true, transactions: [] });
  });

  it("rejects an invalid month or limit", async () => {
    expect(await transactions.monthSummary(max, OWN, "2026-13")).toEqual({ ok: false, reason: "invalid-input" });
    expect(await transactions.categorySpending(max, OWN, "x")).toEqual({ ok: false, reason: "invalid-input" });
    expect(await transactions.latestTransactions(max, OWN, 0)).toEqual({ ok: false, reason: "invalid-input" });
  });
});

describe("monthly expense totals inside another part's database transaction", () => {
  const totals = (caller: Caller, accountId: string, month?: string) =>
    withSession(setup.db, caller, (tx) => transactions.expenseTotals(tx, accountId, month));

  it("sums the expenses with category per category key, refunds lowering the sum", async () => {
    await create(max, { date: "2026-10-01", amount: "-30,00", category: "groceries.supermarket" });
    await create(max, { date: "2026-10-31", amount: "-10,00", category: "groceries.supermarket" });
    await create(max, { date: "2026-10-05", amount: "5,00", category: "groceries.supermarket" });
    await create(max, { date: "2026-10-06", amount: "-7,00", category: "groceries" });
    await create(max, { date: "2026-10-07", amount: "-2,00", category: null });

    expect(await totals(max, "max-private", "2026-10")).toEqual({
      month: "2026-10",
      totals: { "groceries.supermarket": -3500, groceries: -700 },
    });
  });

  it("leaves out income, transfers, saving and other months", async () => {
    await create(max, { date: "2026-10-02", amount: "100,00", kind: "income", category: "salary" });
    await create(max, { date: "2026-10-03", amount: "-50,00", kind: "transfer", category: null });
    await create(max, { date: "2026-10-04", amount: "-60,00", kind: "saving", category: null });
    await create(max, { date: "2026-09-30", amount: "-9,00", category: "groceries" });
    await create(max, { date: "2026-11-01", amount: "-9,00", category: "groceries" });

    expect(await totals(max, "max-private", "2026-10")).toEqual({ month: "2026-10", totals: {} });
  });

  it("uses the current month without a month", async () => {
    await create(max, { date: "2026-10-21", amount: "-4,00", category: "health" });
    expect(await totals(max, "max-private")).toEqual({ month: "2026-10", totals: { health: -400 } });
  });

  it("sums nothing of an account the caller cannot see", async () => {
    await create(max, { date: "2026-10-08", amount: "-4,00", category: "health" });
    expect(await totals(erika, "max-private", "2026-10")).toEqual({ month: "2026-10", totals: {} });
  });
});

describe("bookings written inside another part's database transaction", () => {
  const values = (overrides: Partial<TransactionValues> = {}): TransactionValues => ({
    accountId: "max-private",
    bookingDate: "2026-10-08",
    amountCents: -350,
    kind: "expense",
    category: null,
    counterparty: "Bäckerei",
    counterpartyIban: IBAN,
    reference: "Brötchen",
    ...overrides,
  });

  it("inserts bookings created by the session's user, encrypted", async () => {
    const ids = await withSession(setup.db, max, (tx, userId) =>
      transactions.insertBookings(tx, userId, [values(), values({ amountCents: 5000, kind: "income" })]),
    );
    expect(ids).toHaveLength(2);
    const listed = await list(max, { accountId: "max-private", month: "2026-10" });
    expect(listed.map((t) => [t.amountCents, t.counterparty, t.createdByMe]).sort()).toEqual([
      [-350, "Bäckerei", true],
      [5000, "Bäckerei", true],
    ]);
    const row = await storedRow(ids[0]);
    expect(JSON.stringify(row)).not.toContain("Bäckerei");
    expect(row.counterpartyIbanIndex).toBeTruthy();
  });

  it("refuses invalid values", async () => {
    await expect(
      withSession(setup.db, max, (tx, userId) => transactions.insertBookings(tx, userId, [values({ amountCents: 0 })])),
    ).rejects.toThrow();
  });

  it("cannot insert into another member's private account", async () => {
    await expect(
      withSession(setup.db, erika, (tx, userId) => transactions.insertBookings(tx, userId, [values()])),
    ).rejects.toThrow();
    expect(await list(max, { accountId: "max-private", month: "2026-10" })).toEqual([]);
  });

  it("deletes only visible bookings among the ids", async () => {
    const own = await create(max);
    const shared = await create(max, { accountId: "home-shared" });
    const deleted = await withSession(setup.db, erika, (tx) => transactions.deleteBookings(tx, [own.id, shared.id]));
    expect(deleted).toBe(1);
    expect(await storedRow(own.id)).toBeDefined();
    expect(await storedRow(shared.id)).toBeUndefined();
  });

  it("deletes nothing for an empty list", async () => {
    expect(await withSession(setup.db, max, (tx) => transactions.deleteBookings(tx, []))).toBe(0);
  });
});

describe("finding bookings and changing their type inside another part's database transaction", () => {
  it("finds visible bookings by id, and by account, amount and date range", async () => {
    const a = await create(max, { date: "2026-10-01", amount: "-50,00" });
    const b = await create(max, { accountId: "home-shared", date: "2026-10-03", amount: "50,00", kind: "income", category: null });
    await create(max, { accountId: "home-shared", date: "2026-10-30", amount: "50,00", kind: "income", category: null });
    const byId = await withSession(setup.db, max, (tx, userId) => transactions.findBookings(tx, userId, { ids: [a.id, b.id] }));
    expect(byId.map((view) => view.id).sort()).toEqual([a.id, b.id].sort());
    expect(byId.find((view) => view.id === a.id)).toMatchObject({ counterparty: "Bäckerei Müller", createdByMe: true });

    const opposite = await withSession(setup.db, max, (tx, userId) =>
      transactions.findBookings(tx, userId, { amountCents: 5000, from: "2026-09-20", to: "2026-10-15" }),
    );
    expect(opposite.map((view) => view.id)).toEqual([b.id]);
  });

  it("never finds bookings the caller may not see", async () => {
    const own = await create(max);
    const found = await withSession(setup.db, erika, (tx, userId) => transactions.findBookings(tx, userId, { ids: [own.id] }));
    expect(found).toEqual([]);
    const byAmount = await withSession(setup.db, dora, (tx, userId) => transactions.findBookings(tx, userId, { amountCents: -350 }));
    expect(byAmount).toEqual([]);
  });

  it("sets the type and drops a category that no longer fits", async () => {
    const booking = await create(max);
    const changed = await withSession(setup.db, max, (tx) => transactions.setKind(tx, [booking.id], "transfer"));
    expect(changed).toBe(1);
    expect(await storedRow(booking.id)).toMatchObject({ kind: "transfer", category: null });
  });

  it("does not change bookings the caller may not see", async () => {
    const booking = await create(max);
    const changed = await withSession(setup.db, erika, (tx) => transactions.setKind(tx, [booking.id], "transfer"));
    expect(changed).toBe(0);
    expect(await storedRow(booking.id)).toMatchObject({ kind: "expense" });
  });
});

describe("who set a booking's type and category", () => {
  const values = (overrides: Partial<TransactionValues> = {}): TransactionValues => ({
    accountId: "max-private",
    bookingDate: "2026-10-08",
    amountCents: -350,
    kind: "expense",
    category: null,
    counterparty: "REWE",
    counterpartyIban: null,
    reference: null,
    ...overrides,
  });
  const imported = (overrides: Partial<TransactionValues> = {}) =>
    withSession(setup.db, max, (tx, userId) => transactions.insertBookings(tx, userId, [values(overrides)])).then(([id]) => id);

  it("marks imported bookings as auto, and a booking entered with a category as manual", async () => {
    const id = await imported();
    expect((await transactions.getTransaction(max, id))?.classifiedBy).toBe("auto");
    expect((await create(max)).classifiedBy).toBe("manual");
    expect((await create(max, { category: "" })).classifiedBy).toBe("auto");
  });

  it("marks a booking as manual when its type or category is changed by hand, not for other fields", async () => {
    const id = await imported();
    const texts = await transactions.updateTransaction(max, id, { reference: "Einkauf", kind: "expense", category: "" });
    expect(texts.ok && texts.transaction.classifiedBy).toBe("auto");
    const category = await transactions.updateTransaction(max, id, { category: "groceries.supermarket" });
    expect(category.ok && category.transaction.classifiedBy).toBe("manual");
  });

  it("marks a type set through setKind as manual (transfers' manual actions)", async () => {
    const id = await imported();
    await withSession(setup.db, max, (tx) => transactions.setKind(tx, [id], "transfer"));
    expect(await storedRow(id)).toMatchObject({ kind: "transfer", classifiedBy: "manual" });
  });

  it("lets rules set type and category, but never on a manual booking", async () => {
    const auto = await imported();
    const manual = (await create(max, { category: "shopping" })).id;
    const changed = await withSession(setup.db, max, (tx) =>
      transactions.classifyBookings(tx, [
        { id: auto, kind: "expense", category: "groceries.supermarket" },
        { id: manual, kind: "expense", category: "groceries.supermarket" },
      ]),
    );
    expect(changed).toEqual([auto]);
    expect(await storedRow(auto)).toMatchObject({ category: "groceries.supermarket", classifiedBy: "rule" });
    expect(await storedRow(manual)).toMatchObject({ category: "shopping", classifiedBy: "manual" });
  });

  it("refuses a rule category that does not fit the type, and bookings the caller may not see", async () => {
    const id = await imported();
    await expect(
      withSession(setup.db, max, (tx) => transactions.classifyBookings(tx, [{ id, kind: "transfer", category: "groceries" }])),
    ).rejects.toThrow();
    const changed = await withSession(setup.db, erika, (tx) =>
      transactions.classifyBookings(tx, [{ id, kind: "income", category: null }]),
    );
    expect(changed).toEqual([]);
    expect(await storedRow(id)).toMatchObject({ kind: "expense", classifiedBy: "auto" });
  });

  it("finds an account's uncategorized expenses and income that nobody classified by hand", async () => {
    const open = await imported();
    await imported({ category: "groceries" });
    await imported({ kind: "transfer" });
    await create(max, { category: "" });
    const manualId = (await create(max, { category: "" })).id;
    await transactions.updateTransaction(max, manualId, { kind: "income" });
    const found = await withSession(setup.db, max, (tx, userId) =>
      transactions.findBookings(tx, userId, { accountId: "max-private", uncategorized: true }),
    );
    expect(found.map((b) => b.id)).toContain(open);
    expect(found.map((b) => b.id)).not.toContain(manualId);
    expect(found.every((b) => b.category === null && (b.kind === "expense" || b.kind === "income"))).toBe(true);
    expect(found).toHaveLength(2);
  });
});

describe("merging imported data into a booking entered by hand", () => {
  const imported = {
    bookingDate: "2026-10-09",
    counterparty: "BAECKEREI MUELLER GMBH",
    counterpartyIban: "DE02120300000000202051",
    reference: "Kartenzahlung 09.10.",
  };

  it("takes over date, counterparty, IBAN and reference and keeps type, category, creator and who classified", async () => {
    const booking = await create(max);
    const previous = await withSession(setup.db, max, (tx) => transactions.mergeImported(tx, booking.id, imported));
    expect(previous).toEqual({
      bookingDate: "2026-10-08",
      counterparty: "Bäckerei Müller",
      counterpartyIban: IBAN,
      reference: "Brötchen",
      kind: "expense",
      category: "groceries.supermarket",
      classifiedBy: "manual",
    });
    const merged = await transactions.getTransaction(max, booking.id);
    expect(merged).toMatchObject({
      id: booking.id,
      date: "2026-10-09",
      amountCents: -350,
      kind: "expense",
      category: "groceries.supermarket",
      classifiedBy: "manual",
      counterparty: "BAECKEREI MUELLER GMBH",
      counterpartyIban: "DE02 1203 0000 0000 2020 51",
      reference: "Kartenzahlung 09.10.",
      createdByMe: true,
    });
    const row = await storedRow(booking.id);
    expect(row.counterpartyEncrypted).not.toContain("BAECKEREI");
    expect(row.counterpartyIbanIndex).toBe(setup.crypto.blindIndex("DE02120300000000202051", "transaction.counterpartyIban"));
  });

  it("returns null and changes nothing for a booking the caller may not see", async () => {
    const booking = await create(max);
    const previous = await withSession(setup.db, erika, (tx) => transactions.mergeImported(tx, booking.id, imported));
    expect(previous).toBeNull();
    expect(await transactions.getTransaction(max, booking.id)).toEqual(booking);
  });

  it("restores the values from before the merge", async () => {
    const booking = await create(max, { category: "", counterpartyIban: "" });
    expect(booking.classifiedBy).toBe("auto");
    const previous = await withSession(setup.db, max, (tx) => transactions.mergeImported(tx, booking.id, imported));
    // A rule sorts the merged booking after the import.
    await withSession(setup.db, max, (tx) => transactions.classifyBookings(tx, [{ id: booking.id, kind: "expense", category: "leisure" }]));
    const restored = await withSession(setup.db, max, (tx) => transactions.restoreMerged(tx, booking.id, previous!));
    expect(restored).toBe(true);
    expect(await transactions.getTransaction(max, booking.id)).toEqual(booking);
  });

  it("keeps a classification made by hand after the merge", async () => {
    const booking = await create(max, { category: "" });
    const previous = await withSession(setup.db, max, (tx) => transactions.mergeImported(tx, booking.id, imported));
    await transactions.updateTransaction(max, booking.id, { category: "leisure" });
    await withSession(setup.db, max, (tx) => transactions.restoreMerged(tx, booking.id, previous!));
    expect(await transactions.getTransaction(max, booking.id)).toMatchObject({
      date: "2026-10-08",
      counterparty: "Bäckerei Müller",
      category: "leisure",
      classifiedBy: "manual",
    });
  });

  it("restores nothing the caller may not see", async () => {
    const booking = await create(max);
    const previous = await withSession(setup.db, max, (tx) => transactions.mergeImported(tx, booking.id, imported));
    expect(await withSession(setup.db, erika, (tx) => transactions.restoreMerged(tx, booking.id, previous!))).toBe(false);
    expect(await transactions.getTransaction(max, booking.id)).toMatchObject({ date: "2026-10-09" });
  });
});

describe("own categories on bookings", () => {
  let categories: ReturnType<typeof createCategories>;

  async function own(caller: Caller, input: Record<string, unknown>) {
    const result = await categories.createCategory(caller, { scope: "household", kind: "expense", ...input });
    if (!result.ok) throw new Error(result.reason);
    return result.category;
  }

  beforeEach(async () => {
    categories = createCategories({ db: setup.db });
    await setup.addAccount("erika-private", "erika");
  });

  it("accepts household categories on every account and personal ones on the owner's private accounts", async () => {
    const bakery = await own(max, { parentKey: "groceries", name: "Bäcker" });
    const hobby = await own(max, { scope: "personal", name: "Modellbau" });
    expect(await create(max, { category: bakery.key })).toMatchObject({ category: bakery.key });
    expect(await create(erika, { accountId: "home-shared", category: bakery.key })).toMatchObject({ category: bakery.key });
    expect(await create(max, { category: hobby.key })).toMatchObject({ category: hobby.key });
    const bonus = await own(max, { scope: "personal", kind: "income", parentKey: "salary", name: "Bonus" });
    expect(await create(max, { amount: "100,00", kind: "income", category: bonus.key })).toMatchObject({ category: bonus.key });
  });

  it("rejects personal categories on shared accounts, other people's categories, wrong types and archived ones", async () => {
    const hobby = await own(max, { scope: "personal", name: "Modellbau" });
    const pets = await own(max, { name: "Haustiere" });
    const invalid = { ok: false, reason: "invalid-input" };
    expect(await transactions.createTransaction(max, input({ accountId: "home-shared", category: hobby.key }))).toEqual(invalid);
    expect(await transactions.createTransaction(erika, input({ accountId: "erika-private", category: hobby.key }))).toEqual(invalid);
    expect(await transactions.createTransaction(dora, input({ accountId: "dora-shared", category: pets.key }))).toEqual(invalid);
    expect(await transactions.createTransaction(max, input({ amount: "5,00", kind: "income", category: pets.key }))).toEqual(invalid);
    expect(await transactions.createTransaction(max, input({ category: `groceries.c_${pets.id}` }))).toEqual(invalid);
    expect(await transactions.createTransaction(max, input({ category: "c_00000000-0000-4000-8000-000000000000" }))).toEqual(invalid);
    await categories.setArchived(max, pets.id, true);
    expect(await transactions.createTransaction(max, input({ category: pets.key }))).toEqual(invalid);
  });

  it("checks the category again when a booking moves or its category changes, but keeps an unchanged archived one", async () => {
    const hobby = await own(max, { scope: "personal", name: "Modellbau" });
    const pets = await own(max, { name: "Haustiere" });
    const booking = await create(max, { category: hobby.key });
    expect(await transactions.updateTransaction(max, booking.id, { accountId: "home-shared" })).toEqual({ ok: false, reason: "invalid-input" });
    expect(await transactions.updateTransaction(erika, booking.id, { category: pets.key })).toEqual({ ok: false, reason: "not-found" });
    const withPets = await create(max, { category: pets.key });
    await categories.setArchived(max, pets.id, true);
    expect(await transactions.updateTransaction(max, withPets.id, { amount: "-9,99" })).toMatchObject({ ok: true, transaction: { category: pets.key } });
    expect(await transactions.updateTransaction(max, booking.id, { category: pets.key })).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("drops an own category when the type changes, and keeps it when the type stays", async () => {
    const pets = await own(max, { name: "Haustiere" });
    const booking = await create(max, { category: pets.key });
    expect(await transactions.updateTransaction(max, booking.id, { kind: "expense" })).toMatchObject({ transaction: { category: pets.key } });
    expect(await transactions.updateTransaction(max, booking.id, { kind: "income" })).toMatchObject({ transaction: { kind: "income", category: null } });
    const other = await create(max, { category: pets.key });
    await withSession(setup.db, max, (tx) => transactions.setKind(tx, [other.id], "expense"));
    expect((await storedRow(other.id)).category).toBe(pets.key);
    await withSession(setup.db, max, (tx) => transactions.setKind(tx, [other.id], "transfer"));
    expect((await storedRow(other.id)).category).toBeNull();
  });

  it("checks a category for a whole rule scope, and keeps an archived one only when asked", async () => {
    const hobby = await own(max, { scope: "personal", name: "Modellbau" });
    const pets = await own(max, { name: "Haustiere" });
    const check = (caller: Caller, visibility: "shared" | "private", key: string, allowArchived = false) =>
      withSession(setup.db, caller, (tx) => transactions.checkCategory(tx, { visibility }, "expense", key, { allowArchived }));
    expect(await check(max, "private", hobby.key)).toBe(true);
    expect(await check(max, "shared", hobby.key)).toBe(false);
    expect(await check(max, "shared", pets.key)).toBe(true);
    expect(await check(erika, "private", hobby.key)).toBe(false);
    expect(await check(dora, "shared", pets.key)).toBe(false);
    await categories.setArchived(max, pets.id, true);
    expect(await check(max, "shared", pets.key)).toBe(false);
    expect(await check(max, "shared", pets.key, true)).toBe(true);
  });

  it("lets rules set an own category only where it fits the booking's account", async () => {
    const hobby = await own(max, { scope: "personal", name: "Modellbau" });
    const pets = await own(max, { name: "Haustiere" });
    const onPrivate = await create(max, { category: null });
    const onShared = await create(max, { accountId: "home-shared", category: null });
    const classify = (items: { id: string; category: string }[]) =>
      withSession(setup.db, max, (tx) => transactions.classifyBookings(tx, items.map((i) => ({ ...i, kind: "expense" as const }))));
    expect(await classify([{ id: onPrivate.id, category: hobby.key }, { id: onShared.id, category: hobby.key }])).toEqual([onPrivate.id]);
    expect((await storedRow(onShared.id)).category).toBeNull();
    await categories.setArchived(max, pets.id, true);
    expect(await classify([{ id: onShared.id, category: pets.key }])).toEqual([onShared.id]);
    expect((await storedRow(onShared.id)).category).toBe(pets.key);
  });

  it("offers the check to other parts inside their database transaction", async () => {
    const hobby = await own(max, { scope: "personal", name: "Modellbau" });
    const check = (caller: Caller, accountId: string, key: string) =>
      withSession(setup.db, caller, (tx) => transactions.checkCategory(tx, accountId, "expense", key));
    expect(await check(max, "max-private", hobby.key)).toBe(true);
    expect(await check(max, "max-private", "groceries")).toBe(true);
    expect(await check(max, "max-private", "salary")).toBe(false);
    expect(await check(max, "home-shared", hobby.key)).toBe(false);
    expect(await check(erika, "erika-private", hobby.key)).toBe(false);
    expect(await check(erika, "max-private", "groceries")).toBe(false);
  });
});
