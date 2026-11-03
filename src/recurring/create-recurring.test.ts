import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Caller } from "@/shared/rls";
import type { Recurring } from "./contract";
import { createRecurring } from "./create-recurring";
import { createRecurringRunner } from "./run-due";
import { createCategories } from "@/transactions/server";
import { createTestDatabase } from "./test-utils";

let setup: Awaited<ReturnType<typeof createTestDatabase>>;
let recurring: Recurring;
let max: Caller;
let erika: Caller;

const TODAY = "2026-11-03";

const booking = (overrides: Record<string, unknown> = {}) => ({
  accountId: "shared",
  date: "2026-10-28",
  amount: "-1.200,00",
  kind: "expense",
  category: "housing.rent",
  counterparty: "Vermieter GmbH",
  counterpartyIban: "DE89370400440532013000",
  reference: "Miete",
  repeat: { intervalMonths: 1, endDate: null },
  ...overrides,
});

const count = async (table: string) =>
  (await setup.query<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM "${table}"`)))[0].n;

async function create(caller: Caller, overrides: Record<string, unknown> = {}) {
  const result = await recurring.createWithBooking(caller, booking(overrides));
  if (!result.ok) throw new Error(`create failed: ${result.reason}`);
  return result;
}

async function onlyTemplate(caller: Caller) {
  const [template] = await recurring.listTemplates(caller);
  return template;
}

beforeEach(async () => {
  setup = await createTestDatabase();
  await setup.householdOf("home", "max", "erika");
  await setup.addAccount("shared", "max", "home");
  await setup.addAccount("max-private", "max");
  recurring = createRecurring({ db: setup.db, transactions: setup.transactions, today: () => TODAY });
  [max, erika] = await Promise.all([setup.as("max"), setup.as("erika")]);
});

describe("creating a template with its first booking", () => {
  it("creates booking and template together", async () => {
    const result = await create(max);
    expect(await count("transaction")).toBe(1);
    expect(await onlyTemplate(max)).toMatchObject({
      id: result.templateId,
      accountId: "shared",
      amountCents: -120000,
      kind: "expense",
      category: "housing.rent",
      intervalMonths: 1,
      dayOfMonth: 28,
      nextDueDate: "2026-11-28",
      endDate: null,
      status: "active",
      createdByMe: true,
    });
    const occurrences = await setup.query<{ due_date: string; transaction_id: string }>(
      sql`SELECT due_date::text, transaction_id FROM recurring_occurrence`,
    );
    expect(occurrences).toEqual([{ due_date: "2026-10-28", transaction_id: result.transaction.id }]);
  });

  it("day 31 gives the month's last day next", async () => {
    await create(max, { date: "2026-01-31" });
    expect(await onlyTemplate(max)).toMatchObject({ dayOfMonth: 31, nextDueDate: "2026-02-28" });
  });

  it("saves nothing when the booking is invalid", async () => {
    expect(await recurring.createWithBooking(max, booking({ amount: "abc" }))).toEqual({ ok: false, reason: "invalid-input" });
    expect(await count("transaction")).toBe(0);
    expect(await count("recurring_template")).toBe(0);
  });

  it("saves nothing with an invalid repeat", async () => {
    expect(await recurring.createWithBooking(max, booking({ repeat: { intervalMonths: 2, endDate: null } }))).toEqual({
      ok: false,
      reason: "invalid-input",
    });
    expect(await count("transaction")).toBe(0);
  });

  it("saves nothing with an end before the booking date", async () => {
    expect(await recurring.createWithBooking(max, booking({ repeat: { intervalMonths: 1, endDate: "2026-10-01" } }))).toEqual({
      ok: false,
      reason: "invalid-input",
    });
    expect(await count("transaction")).toBe(0);
  });

  it("the runner does not book the first date again", async () => {
    await create(max);
    expect(await createRecurringRunner({ db: setup.db }).runDue("2026-10-28")).toBe(0);
    expect(await count("transaction")).toBe(1);
  });

  it("the runner books the next date with the same texts", async () => {
    await create(max);
    expect(await createRecurringRunner({ db: setup.db }).runDue("2026-11-28")).toBe(1);
    const result = await setup.transactions.listTransactions(max, { accountId: "shared", from: "2026-11-01", to: "2026-11-30" });
    expect(result.ok && result.transactions[0]).toMatchObject({
      date: "2026-11-28",
      amountCents: -120000,
      counterparty: "Vermieter GmbH",
      counterpartyIban: "DE89 3704 0044 0532 0130 00",
      reference: "Miete",
      classifiedBy: "manual",
    });
  });

  it("texts round-trip", async () => {
    await create(max);
    expect(await onlyTemplate(erika)).toMatchObject({
      counterparty: "Vermieter GmbH",
      counterpartyIban: "DE89 3704 0044 0532 0130 00",
      reference: "Miete",
      createdByMe: false,
    });
  });
});

describe("privacy", () => {
  it("erika never sees max's private template", async () => {
    const { templateId } = await create(max, { accountId: "max-private", category: "groceries.supermarket" });
    expect(await recurring.listTemplates(erika)).toEqual([]);
    expect(await recurring.act(erika, templateId, { action: "pause" })).toEqual({ ok: false, reason: "not-found" });
    expect(await recurring.deleteTemplate(erika, templateId)).toBe(false);
    expect((await onlyTemplate(max)).status).toBe("active");
  });

  it("erika cannot create a template on max's private account", async () => {
    expect(await recurring.createWithBooking(erika, booking({ accountId: "max-private" }))).toEqual({ ok: false, reason: "not-found" });
    expect(await count("recurring_template")).toBe(0);
  });
});

describe("managing templates", () => {
  it("pause and resume skip the pause", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-09-28" });
    expect(await recurring.act(max, "rent", { action: "pause" })).toMatchObject({ ok: true, template: { status: "paused" } });
    expect(await recurring.act(max, "rent", { action: "resume" })).toMatchObject({
      ok: true,
      template: { status: "active", nextDueDate: "2026-11-28" },
    });
    expect(await createRecurringRunner({ db: setup.db }).runDue(TODAY)).toBe(0);
  });

  it("resume keeps a next date in the future", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2027-01-28", intervalMonths: 3, paused: true });
    expect(await recurring.act(max, "rent", { action: "resume" })).toMatchObject({ template: { nextDueDate: "2027-01-28" } });
  });

  it("end sets the end date to today", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-11-28" });
    expect(await recurring.act(max, "rent", { action: "end" })).toMatchObject({
      ok: true,
      template: { endDate: TODAY, status: "ended" },
    });
  });

  it("end keeps an earlier end date", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-10-28", endDate: "2026-10-01" });
    expect(await recurring.act(max, "rent", { action: "end" })).toMatchObject({ template: { endDate: "2026-10-01", status: "ended" } });
    expect(await createRecurringRunner({ db: setup.db }).runDue(TODAY)).toBe(0);
  });

  it("resume on an active template keeps the dates still due", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-10-28" });
    expect(await recurring.act(max, "rent", { action: "resume" })).toMatchObject({ template: { nextDueDate: "2026-10-28", status: "active" } });
  });

  it("rejects an unknown action", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared" });
    expect(await recurring.act(max, "rent", { action: "stop" })).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("delete keeps the bookings", async () => {
    const { templateId } = await create(max);
    expect(await recurring.deleteTemplate(max, templateId)).toBe(true);
    expect(await count("recurring_template")).toBe(0);
    expect(await count("transaction")).toBe(1);
  });

  it("marks templates of archived accounts", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared" });
    const [template] = await recurring.listTemplates(max, { archivedAccountIds: new Set(["shared"]) });
    expect(template.status).toBe("archived");
  });

  it("lists the next due first", async () => {
    await setup.addTemplate({ id: "later", accountId: "shared", nextDueDate: "2026-12-28" });
    await setup.addTemplate({ id: "sooner", accountId: "shared", nextDueDate: "2026-11-28" });
    expect((await recurring.listTemplates(max)).map((t) => t.id)).toEqual(["sooner", "later"]);
  });
});

describe("templates without a first booking", () => {
  const template = (overrides: Record<string, unknown> = {}) => ({
    accountId: "shared",
    amount: "-12,99",
    kind: "expense",
    category: null,
    counterparty: "Streaming GmbH",
    counterpartyIban: "DE89 3704 0044 0532 0130 00",
    reference: "Abo",
    countsNextMonth: null,
    intervalMonths: 1,
    nextDueDate: "2026-11-15",
    endDate: null,
    ...overrides,
  });

  it("createTemplate saves a template without a booking", async () => {
    const result = await recurring.createTemplate(max, template());
    expect(result).toMatchObject({
      ok: true,
      template: { dayOfMonth: 15, nextDueDate: "2026-11-15", counterparty: "Streaming GmbH", counterpartyIban: "DE89 3704 0044 0532 0130 00", reference: "Abo" },
    });
    expect(await count("transaction")).toBe(0);
  });

  it("createTemplate rejects a next date before today", async () => {
    expect(await recurring.createTemplate(max, template({ nextDueDate: "2026-11-02" }))).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("createTemplate rejects a category the account does not offer", async () => {
    expect(await recurring.createTemplate(max, template({ category: "nonsense.key" }))).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("createTemplate on max's private account as erika", async () => {
    expect(await recurring.createTemplate(erika, template({ accountId: "max-private" }))).toEqual({ ok: false, reason: "not-found" });
    expect(await count("recurring_template")).toBe(0);
  });

  it("updateTemplate changes future bookings only", async () => {
    const { templateId, transaction } = await create(max);
    const updated = await recurring.updateTemplate(max, templateId, template({ amount: "-1.250,00", category: "housing.rent", nextDueDate: "2026-11-28" }));
    expect(updated.ok).toBe(true);
    expect(await createRecurringRunner({ db: setup.db }).runDue("2026-11-28")).toBe(1);
    const amounts = await setup.query<{ id: string; amount_cents: number }>(sql`SELECT id, amount_cents FROM "transaction" ORDER BY booking_date`);
    expect(amounts).toEqual([
      { id: transaction.id, amount_cents: -120000 },
      { id: expect.any(String), amount_cents: -125000 },
    ]);
  });

  it("updateTemplate moves the day with the next date", async () => {
    const { templateId } = await create(max);
    expect(await recurring.updateTemplate(max, templateId, template({ nextDueDate: "2026-12-05" }))).toMatchObject({
      template: { dayOfMonth: 5, nextDueDate: "2026-12-05" },
    });
  });

  it("updateTemplate keeps paused", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", paused: true });
    expect(await recurring.updateTemplate(max, "rent", template())).toMatchObject({ template: { status: "paused" } });
  });

  it("updateTemplate rejects invisible templates and accounts", async () => {
    await setup.addTemplate({ id: "mine", accountId: "max-private" });
    await setup.addTemplate({ id: "ours", accountId: "shared" });
    expect(await recurring.updateTemplate(erika, "mine", template())).toEqual({ ok: false, reason: "not-found" });
    expect(await recurring.updateTemplate(erika, "ours", template({ accountId: "max-private" }))).toEqual({ ok: false, reason: "not-found" });
    expect((await recurring.getTemplate(max, "ours"))?.accountId).toBe("shared");
  });

  it("getTemplate as erika for max's private template", async () => {
    await setup.addTemplate({ id: "mine", accountId: "max-private" });
    expect(await recurring.getTemplate(erika, "mine")).toBeNull();
    expect((await recurring.getTemplate(max, "mine"))?.id).toBe("mine");
  });

  it("templateOfBookings maps bookings to their template", async () => {
    const { templateId, transaction } = await create(max);
    const plain = await setup.transactions.createTransaction(max, { ...booking(), repeat: undefined, date: "2026-10-01" });
    if (!plain.ok) throw new Error("plain booking failed");
    const map = await recurring.templateOfBookings(max, [transaction.id, plain.transaction.id]);
    expect([...map]).toEqual([[transaction.id, templateId]]);
    expect(await recurring.templateOfBookings(erika, [])).toEqual(new Map());
  });
});

describe("editing keeps what the user did not change", () => {
  const form = (overrides: Record<string, unknown> = {}) => ({
    accountId: "shared",
    amount: "3.000,00",
    kind: "income",
    category: null,
    counterparty: "Arbeitgeber",
    counterpartyIban: "",
    reference: "Gehalt",
    countsNextMonth: null,
    intervalMonths: 1,
    nextDueDate: "2026-11-30",
    endDate: null,
    ...overrides,
  });

  it("a day-31 template edited at the end of a short month still books on the 31st", async () => {
    await setup.addTemplate({ id: "pay", accountId: "shared", amountCents: 300000, kind: "income", dayOfMonth: 31, nextDueDate: "2026-11-30" });
    expect(await recurring.updateTemplate(max, "pay", form({ reference: "Gehalt neu" }))).toMatchObject({ template: { dayOfMonth: 31 } });
    expect(await createRecurringRunner({ db: setup.db }).runDue("2026-12-31")).toBe(2);
    const dates = await setup.query<{ d: string }>(sql`SELECT booking_date::text AS d FROM "transaction" ORDER BY booking_date`);
    expect(dates.map((r) => r.d)).toEqual(["2026-11-30", "2026-12-31"]);
  });

  it("a paused template with a past next date can still be saved unchanged", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-09-28", paused: true });
    expect(await recurring.updateTemplate(max, "rent", form({ kind: "expense", amount: "-1.300,00", nextDueDate: "2026-09-28" }))).toMatchObject({
      ok: true,
      template: { amountCents: -130000, status: "paused" },
    });
  });

  it("an active template still rejects a past next date", async () => {
    await setup.addTemplate({ id: "rent", accountId: "shared", nextDueDate: "2026-09-28" });
    expect(await recurring.updateTemplate(max, "rent", form({ nextDueDate: "2026-09-28" }))).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("keeps auto when the category stays the same", async () => {
    await setup.addTemplate({ id: "pay", accountId: "shared", amountCents: 300000, kind: "income", category: "salary", classifiedBy: "auto" });
    expect((await recurring.updateTemplate(max, "pay", form({ category: "salary", nextDueDate: "2026-11-28" }))).ok).toBe(true);
    const [row] = await setup.query<{ classified_by: string }>(sql`SELECT classified_by FROM recurring_template WHERE id = 'pay'`);
    expect(row.classified_by).toBe("auto");
  });

  it("keeps an archived category when other fields change, but rejects switching to one", async () => {
    const categories = createCategories({ db: setup.db });
    const own = await categories.createCategory(max, { scope: "household", kind: "expense", name: "Streaming" });
    const other = await categories.createCategory(max, { scope: "household", kind: "expense", name: "Altes" });
    if (!own.ok || !other.ok) throw new Error("category failed");
    const created = await recurring.createTemplate(max, form({ kind: "expense", amount: "-9,99", category: own.category.key, nextDueDate: "2026-11-15" }));
    if (!created.ok) throw new Error("create failed");
    await categories.setArchived(max, own.category.id, true);
    await categories.setArchived(max, other.category.id, true);
    const keep = form({ kind: "expense", amount: "-10,99", category: own.category.key, nextDueDate: "2026-11-15" });
    expect(await recurring.updateTemplate(max, created.template.id, keep)).toMatchObject({ ok: true, template: { amountCents: -1099 } });
    const switched = { ...keep, category: other.category.key };
    expect(await recurring.updateTemplate(max, created.template.id, switched)).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("templateOfBookings leaves out bookings the caller cannot see", async () => {
    const { templateId, transaction } = await create(max, { accountId: "max-private", category: "groceries.supermarket" });
    // Max moves the template to the shared account; the old booking stays private.
    await setup.db.execute(sql`UPDATE recurring_template SET account_id = 'shared' WHERE id = ${templateId}`);
    expect(await recurring.templateOfBookings(erika, [transaction.id])).toEqual(new Map());
    expect(await recurring.templateOfBookings(max, [transaction.id])).toEqual(new Map([[transaction.id, templateId]]));
  });
});
