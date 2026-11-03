import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { recurringRoute } from "@/app/_lib/recurring-route";
import { transactionsRoute } from "@/app/_lib/transactions-route";
import { createAccounts, type Accounts } from "@/accounts/server";
import { createHouseholds } from "@/households/server";
import { createRecurring, type Recurring } from "@/recurring/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import type { Caller, RlsDatabase } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createTransactions, type Transactions } from "@/transactions/server";

// Privacy tests for the regular bookings routes: a member never creates, changes or deletes a
// template on another member's private account, and learns nothing about it (404 like unknown ids).

let db: RlsDatabase;
let accounts: Accounts;
let transactions: Transactions;
let recurring: Recurring;
let callers: Map<string, Promise<Caller>>;
let maxPrivate: string;
let shared: string;

function sessionOf(userId: string | null) {
  return async () => {
    if (userId === null) return null;
    if (!callers.has(userId)) callers.set(userId, createTestSession(db, userId));
    return callers.get(userId)!;
  };
}

const caller = async (userId: string) => (await sessionOf(userId)())!;
const bookingsAs = (userId: string | null) => transactionsRoute({ transactions, recurring, getCaller: sessionOf(userId) });
const templateAs = (userId: string | null) => recurringRoute({ recurring, getCaller: sessionOf(userId) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (method: string, body?: unknown) =>
  new Request("http://localhost/api/recurring", { method, body: body === undefined ? undefined : JSON.stringify(body) });

const booking = (accountId: string) => ({
  accountId,
  date: "2026-10-28",
  amount: "-1.200,00",
  kind: "expense",
  category: "housing.rent",
  counterparty: "Vermieter GmbH",
  reference: "Miete",
  repeat: { intervalMonths: 1, endDate: null },
});

const count = async (table: string) =>
  ((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${table}"`))) as unknown as { rows: { n: number }[] }).rows[0].n;

async function createAccount(userId: string, visibility: "private" | "shared", name: string) {
  const result = await accounts.createAccount(await caller(userId), { name, bank: "ing", type: "checking", visibility, openingBalance: "0" });
  if (!result.ok) throw new Error(result.reason);
  return result.accounts[0].id;
}

async function createTemplate(userId: string, accountId: string): Promise<string> {
  const response = await bookingsAs(userId).POST(request("POST", booking(accountId)));
  expect(response.status).toBe(201);
  return (await response.json()).templateId;
}

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite() });
  await migrate(pglite, { migrationsFolder: new URL("../../../../drizzle", import.meta.url).pathname });
  db = pglite;
  callers = new Map();
  const crypto = createFieldCrypto({ keys: `1:${randomBytes(32).toString("base64")}`, indexKey: randomBytes(32).toString("base64") });
  accounts = createAccounts({ db, crypto });
  transactions = createTransactions({ db, crypto });
  recurring = createRecurring({ db, transactions, today: () => "2026-11-03" });
  const households = createHouseholds({ db, householdHoldsData: accounts.householdHasSharedAccounts });
  await households.createHousehold(await caller("max"), { name: "Mustermann" });
  await households.joinInvitersHousehold(await caller("erika"), { inviterId: "max", invitedAt: new Date() });
  maxPrivate = await createAccount("max", "private", "ING Giro");
  shared = await createAccount("max", "shared", "Gemeinschaftskonto");
});

describe("POST /api/transactions with repeat", () => {
  it("creates booking and template", async () => {
    const templateId = await createTemplate("erika", shared);
    expect(templateId).toEqual(expect.any(String));
    expect(await count("transaction")).toBe(1);
    expect(await count("recurring_template")).toBe(1);
  });

  it("answers 404 on max's private account as erika, and saves nothing", async () => {
    expect((await bookingsAs("erika").POST(request("POST", booking(maxPrivate)))).status).toBe(404);
    expect(await count("transaction")).toBe(0);
    expect(await count("recurring_template")).toBe(0);
  });

  it("answers 400 for an invalid repeat", async () => {
    const body = { ...booking(shared), repeat: { intervalMonths: 2, endDate: null } };
    expect((await bookingsAs("max").POST(request("POST", body))).status).toBe(400);
  });
});

describe("/api/recurring/[id]", () => {
  it("pauses a shared template", async () => {
    const id = await createTemplate("max", shared);
    const response = await templateAs("erika").PATCH(request("PATCH", { action: "pause" }), ctx(id));
    expect(response.status).toBe(200);
    expect((await response.json()).template).toMatchObject({ id, status: "paused" });
  });

  it("answers 404 to erika for max's private template and changes nothing", async () => {
    const id = await createTemplate("max", maxPrivate);
    expect((await templateAs("erika").PATCH(request("PATCH", { action: "pause" }), ctx(id))).status).toBe(404);
    expect((await templateAs("erika").DELETE(request("DELETE"), ctx(id))).status).toBe(404);
    const [template] = await recurring.listTemplates(await caller("max"));
    expect(template).toMatchObject({ id, status: "active" });
  });

  it("never sends the creator's user id or ciphertext", async () => {
    const id = await createTemplate("max", shared);
    const text = await (await templateAs("erika").PATCH(request("PATCH", { action: "pause" }), ctx(id))).text();
    expect(text).not.toContain("createdByUserId");
    expect(text).not.toContain("Encrypted");
  });

  it("answers 400 for an unknown action", async () => {
    const id = await createTemplate("max", shared);
    expect((await templateAs("max").PATCH(request("PATCH", { action: "stop" }), ctx(id))).status).toBe(400);
  });

  it("deletes a template and keeps its booking", async () => {
    const id = await createTemplate("max", shared);
    expect((await templateAs("max").DELETE(request("DELETE"), ctx(id))).status).toBe(200);
    expect(await count("recurring_template")).toBe(0);
    expect(await count("transaction")).toBe(1);
  });

  it("needs a session", async () => {
    const id = await createTemplate("max", shared);
    expect((await templateAs(null).PATCH(request("PATCH", { action: "pause" }), ctx(id))).status).toBe(401);
    expect((await templateAs(null).DELETE(request("DELETE"), ctx(id))).status).toBe(401);
  });
});

describe("POST /api/recurring and PATCH with fields", () => {
  const template = (accountId: string, overrides: Record<string, unknown> = {}) => ({
    accountId,
    amount: "-12,99",
    kind: "expense",
    category: null,
    counterparty: "Streaming GmbH",
    counterpartyIban: "",
    reference: "",
    countsNextMonth: null,
    intervalMonths: 1,
    nextDueDate: "2026-11-15",
    endDate: null,
    ...overrides,
  });

  it("creates a template", async () => {
    const response = await templateAs("erika").POST(request("POST", template(shared)));
    expect(response.status).toBe(201);
    expect((await response.json()).template).toMatchObject({ amountCents: -1299, nextDueDate: "2026-11-15" });
    expect(await count("transaction")).toBe(0);
  });

  it("answers 404 for max's private account as erika", async () => {
    expect((await templateAs("erika").POST(request("POST", template(maxPrivate)))).status).toBe(404);
    expect(await count("recurring_template")).toBe(0);
  });

  it("answers 400 for a next date before today", async () => {
    expect((await templateAs("max").POST(request("POST", template(shared, { nextDueDate: "2026-11-02" })))).status).toBe(400);
  });

  it("updates a template", async () => {
    const id = await createTemplate("max", shared);
    const response = await templateAs("erika").PATCH(request("PATCH", template(shared, { amount: "-1.250,00", nextDueDate: "2026-11-28" })), ctx(id));
    expect(response.status).toBe(200);
    expect((await response.json()).template).toMatchObject({ amountCents: -125000 });
  });

  it("answers 404 to erika updating max's private template, unchanged", async () => {
    const id = await createTemplate("max", maxPrivate);
    expect((await templateAs("erika").PATCH(request("PATCH", template(shared)), ctx(id))).status).toBe(404);
    expect(await recurring.getTemplate(await caller("max"), id)).toMatchObject({ amountCents: -120000, accountId: maxPrivate });
  });

  it("needs a session to create", async () => {
    expect((await templateAs(null).POST(request("POST", template(shared)))).status).toBe(401);
  });
});
