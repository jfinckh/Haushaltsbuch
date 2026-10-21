import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withSession, type Caller } from "@/shared/rls";
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
