import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createRecurringRunner } from "./run-due";
import { createTestDatabase } from "./test-utils";

// recurring_book_due (drizzle/0029_recurring_functions.sql) through the runner: books every due date
// of active templates once, catches up missed dates, and leaves paused, ended and archived ones.

let setup: Awaited<ReturnType<typeof createTestDatabase>>;
let runner: ReturnType<typeof createRecurringRunner>;

type Booking = {
  id: string;
  account_id: string;
  booking_date: string;
  amount_cents: number;
  kind: string;
  category: string | null;
  counterparty_encrypted: string | null;
  counterparty_iban_encrypted: string | null;
  counterparty_iban_index: string | null;
  reference_encrypted: string | null;
  counts_next_month: boolean | null;
  classified_by: string;
  created_by_user_id: string;
};

const bookings = () =>
  setup.query<Booking>(sql`SELECT t.*, t.booking_date::text AS booking_date FROM "transaction" t ORDER BY t.booking_date`);

const nextDue = async (id: string) =>
  (await setup.query<{ due: string }>(sql`SELECT next_due_date::text AS due FROM recurring_template WHERE id = ${id}`))[0].due;

beforeEach(async () => {
  setup = await createTestDatabase();
  await setup.householdOf("home", "max", "erika");
  await setup.addAccount("shared", "max", "home");
  runner = createRecurringRunner({ db: setup.db });
});

describe("recurring_book_due", () => {
  it("books a template due today", async () => {
    await setup.addTemplate({
      id: "rent",
      accountId: "shared",
      amountCents: -120000,
      kind: "expense",
      category: "housing.rent",
      counterpartyEncrypted: "cipher-counterparty",
      counterpartyIbanEncrypted: "cipher-iban",
      counterpartyIbanIndex: "index-iban",
      referenceEncrypted: "cipher-reference",
      countsNextMonth: false,
      classifiedBy: "manual",
      nextDueDate: "2026-11-03",
      dayOfMonth: 3,
      createdByUserId: "erika",
    });
    expect(await runner.runDue("2026-11-03")).toBe(1);
    const [booking] = await bookings();
    expect(booking).toMatchObject({
      account_id: "shared",
      booking_date: "2026-11-03",
      amount_cents: -120000,
      kind: "expense",
      category: "housing.rent",
      counterparty_encrypted: "cipher-counterparty",
      counterparty_iban_encrypted: "cipher-iban",
      counterparty_iban_index: "index-iban",
      reference_encrypted: "cipher-reference",
      counts_next_month: false,
      classified_by: "manual",
      created_by_user_id: "erika",
    });
    const [occurrence] = await setup.query<{ transaction_id: string }>(sql`SELECT transaction_id FROM recurring_occurrence`);
    expect(occurrence.transaction_id).toBe(booking.id);
    expect(await nextDue("rent")).toBe("2026-12-03");
  });

  it("catches up every missed date", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-08-28" });
    expect(await runner.runDue("2026-11-03")).toBe(3);
    expect((await bookings()).map((b) => b.booking_date)).toEqual(["2026-08-28", "2026-09-28", "2026-10-28"]);
    expect(await nextDue("rent")).toBe("2026-11-28");
  });

  it("books nothing twice", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-08-28" });
    await runner.runDue("2026-11-03");
    expect(await runner.runDue("2026-11-03")).toBe(0);
    expect(await bookings()).toHaveLength(3);
  });

  it("two runs at the same time book each date once", async () => {
    // PGlite has one connection, so the runs may be serialised; the occurrence key still guards it.
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-08-28" });
    const counts = await Promise.all([runner.runDue("2026-11-03"), runner.runDue("2026-11-03")]);
    expect(counts[0] + counts[1]).toBe(3);
    expect(await bookings()).toHaveLength(3);
  });

  it("does not book a deleted occurrence again", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-10-28" });
    await runner.runDue("2026-11-03");
    await setup.db.execute(sql`DELETE FROM "transaction"`);
    await setup.db.execute(sql`UPDATE recurring_template SET next_due_date = '2026-10-28'`);
    expect(await runner.runDue("2026-11-03")).toBe(0);
    expect(await bookings()).toHaveLength(0);
  });

  it("stops after the end date", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-08-28", endDate: "2026-09-30" });
    expect(await runner.runDue("2026-11-03")).toBe(2);
    expect((await bookings()).map((b) => b.booking_date)).toEqual(["2026-08-28", "2026-09-28"]);
  });

  it("skips paused templates", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-10-28", paused: true });
    expect(await runner.runDue("2026-11-03")).toBe(0);
    expect(await nextDue("rent")).toBe("2026-10-28");
  });

  it("skips archived accounts without catching up later", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-08-28" });
    await setup.setArchived("shared", true);
    expect(await runner.runDue("2026-11-03")).toBe(0);
    expect(await nextDue("rent")).toBe("2026-11-28");
    await setup.setArchived("shared", false);
    expect(await runner.runDue("2026-11-03")).toBe(0);
    expect(await bookings()).toHaveLength(0);
  });

  it("day 31 follows month ends", async () => {
    await setup.addTemplate({ id: "pay", accountId: "shared", amountCents: 300000, kind: "income", dayOfMonth: 31, nextDueDate: "2026-01-31" });
    expect(await runner.runDue("2026-03-31")).toBe(3);
    expect((await bookings()).map((b) => b.booking_date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(await nextDue("pay")).toBe("2026-04-30");
  });

  it("books a quarterly template every three months", async () => {
    await setup.addTemplate({ id: "tax", accountId: "shared", intervalMonths: 3, dayOfMonth: 15, nextDueDate: "2026-02-15" });
    expect(await runner.runDue("2026-11-03")).toBe(3);
    expect((await bookings()).map((b) => b.booking_date)).toEqual(["2026-02-15", "2026-05-15", "2026-08-15"]);
    expect(await nextDue("tax")).toBe("2026-11-15");
  });

  it("ignores temp tables that shadow its tables", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-12-28" });
    await setup.db.execute(sql`CREATE TEMP TABLE recurring_template (LIKE public.recurring_template)`);
    await setup.db.execute(sql`CREATE TEMP TABLE recurring_occurrence (LIKE public.recurring_occurrence)`);
    await setup.db.execute(sql`
      INSERT INTO pg_temp.recurring_template (id, account_id, amount_cents, kind, classified_by, interval_months, day_of_month, next_due_date, paused, created_by_user_id, created_at, updated_at)
      VALUES ('evil', 'shared', -99999, 'expense', 'manual', 1, 1, '2026-11-01', false, 'erika', now(), now())`);
    try {
      expect(await runner.runDue("2026-11-03")).toBe(0);
      expect(await bookings()).toHaveLength(0);
    } finally {
      await setup.db.execute(sql`DROP TABLE pg_temp.recurring_template, pg_temp.recurring_occurrence`);
    }
  });

  it("catches up at most one year", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "1900-01-28" });
    expect(await runner.runDue("2026-11-03")).toBe(12);
    const dates = (await bookings()).map((b) => b.booking_date);
    expect(dates[0]).toBe("2025-11-28");
    expect(dates.at(-1)).toBe("2026-10-28");
    expect(await nextDue("rent")).toBe("2026-11-28");
  });

  it("rejects a next due date that does not fit the day of month", async () => {
    await expect(setup.addTemplate({ id: "odd", accountId: "shared", dayOfMonth: 28, nextDueDate: "2026-02-10" })).rejects.toThrow();
    await setup.addTemplate({ id: "short", accountId: "shared", dayOfMonth: 31, nextDueDate: "2026-02-28" });
  });
});
