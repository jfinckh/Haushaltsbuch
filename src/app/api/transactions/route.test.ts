import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { transactionRoute, transactionsRoute } from "@/app/_lib/transactions-route";
import { createAccounts, type Accounts } from "@/accounts/server";
import { createHouseholds } from "@/households/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import type { Caller, RlsDatabase } from "@/shared/rls";
import { createTestSession, endTestSessions } from "@/shared/test-sessions";
import { createCategories, createTransactions, type Transactions } from "@/transactions/server";

// Privacy tests for every transactions route: a member never receives, changes or learns about
// bookings of another member's private account, and another household sees nothing at all.

let db: RlsDatabase;
let accounts: Accounts;
let transactions: Transactions;
let callers: Map<string, Promise<Caller>>;

function sessionOf(userId: string | null) {
  return async () => {
    if (userId === null) return null;
    if (!callers.has(userId)) callers.set(userId, createTestSession(db, userId));
    return callers.get(userId)!;
  };
}

const caller = async (userId: string) => (await sessionOf(userId)())!;
const listAs = (userId: string | null) => transactionsRoute({ transactions, getCaller: sessionOf(userId) });
const oneAs = (userId: string | null) => transactionRoute({ transactions, getCaller: sessionOf(userId) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (method: string, body?: unknown, query = "") =>
  new Request(`http://localhost/api/transactions${query}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const booking = (accountId: string, overrides: Record<string, unknown> = {}) => ({
  accountId,
  date: "2026-10-08",
  amount: "-3,50",
  kind: "expense",
  category: "groceries",
  counterparty: "Bäckerei Müller",
  reference: "Brötchen",
  ...overrides,
});

async function createAccount(userId: string, visibility: "private" | "shared", name: string) {
  const result = await accounts.createAccount(await caller(userId), {
    name,
    bank: "ing",
    type: "checking",
    visibility,
    openingBalance: "0",
  });
  if (!result.ok) throw new Error(result.reason);
  return result.accounts[0].id;
}

async function book(userId: string, body: unknown): Promise<{ id: string }> {
  const response = await listAs(userId).POST(request("POST", body));
  expect(response.status).toBe(201);
  return (await response.json()).transaction;
}

let maxPrivate: string;
let shared: string;
let doras: string;
let maxBooking: string;
let sharedBooking: string;

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite() });
  await migrate(pglite, { migrationsFolder: new URL("../../../../drizzle", import.meta.url).pathname });
  db = pglite;
  callers = new Map();
  const crypto = createFieldCrypto({
    keys: `1:${randomBytes(32).toString("base64")}`,
    indexKey: randomBytes(32).toString("base64"),
  });
  accounts = createAccounts({ db, crypto });
  transactions = createTransactions({ db, crypto, today: () => "2026-10-21" });
  const households = createHouseholds({ db, householdHoldsData: accounts.householdHasSharedAccounts });
  await households.createHousehold(await caller("max"), { name: "Mustermann" });
  await households.joinInvitersHousehold(await caller("erika"), { inviterId: "max", invitedAt: new Date() });
  await households.createHousehold(await caller("dora"), { name: "Other" });

  maxPrivate = await createAccount("max", "private", "ING Giro");
  shared = await createAccount("max", "shared", "Gemeinschaftskonto");
  doras = await createAccount("dora", "shared", "Doras");
  maxBooking = (await book("max", booking(maxPrivate))).id;
  sharedBooking = (await book("erika", booking(shared))).id;
  await book("dora", booking(doras));
});

describe("/api/transactions", () => {
  it("needs a session", async () => {
    expect((await listAs(null).GET(request("GET", undefined, `?accountId=${shared}`))).status).toBe(401);
    expect((await listAs(null).POST(request("POST", booking(shared)))).status).toBe(401);
  });

  it("answers 401 once the session has ended", async () => {
    await caller("max");
    await endTestSessions(db, "max");
    expect((await listAs("max").GET(request("GET", undefined, `?accountId=${maxPrivate}`))).status).toBe(401);
  });

  it("lists an account's bookings with filters from the query", async () => {
    await book("max", booking(maxPrivate, { date: "2026-09-15", reference: "September" }));
    const response = await listAs("max").GET(request("GET", undefined, `?accountId=${maxPrivate}&month=2026-09`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.transactions.map((t: { reference: string }) => t.reference)).toEqual(["September"]);
  });

  it("never sends the creator's user id or the stored ciphertext", async () => {
    const response = await listAs("erika").GET(request("GET", undefined, `?accountId=${shared}`));
    const text = await response.text();
    expect(text).not.toContain("erika");
    expect(text).not.toContain("createdByUserId");
    expect(text).not.toContain("Encrypted");
    expect(JSON.parse(text).transactions[0]).toMatchObject({ counterparty: "Bäckerei Müller", createdByMe: true });
  });

  it("rejects invalid input", async () => {
    expect((await listAs("max").POST(request("POST", booking(maxPrivate, { amount: "0" })))).status).toBe(400);
    expect((await listAs("max").GET(request("GET", undefined, ""))).status).toBe(400);
  });
});

describe("another member's private account", () => {
  it("cannot be listed or booked on, and looks like an unknown account", async () => {
    const list = await listAs("erika").GET(request("GET", undefined, `?accountId=${maxPrivate}`));
    const unknown = await listAs("erika").GET(request("GET", undefined, "?accountId=nope"));
    expect(list.status).toBe(404);
    expect(await list.json()).toEqual(await unknown.json());
    expect((await listAs("erika").POST(request("POST", booking(maxPrivate)))).status).toBe(404);
  });

  it("has bookings that cannot be read, changed, moved or deleted", async () => {
    const one = oneAs("erika");
    expect((await one.GET(request("GET"), ctx(maxBooking))).status).toBe(404);
    expect((await one.PATCH(request("PATCH", { amount: "-1,00" }), ctx(maxBooking))).status).toBe(404);
    expect((await one.DELETE(request("DELETE"), ctx(maxBooking))).status).toBe(404);
    expect((await one.PATCH(request("PATCH", { accountId: maxPrivate }), ctx(sharedBooking))).status).toBe(404);

    const mine = await (await oneAs("max").GET(request("GET"), ctx(maxBooking))).json();
    expect(mine.transaction.amountCents).toBe(-350);
    const stillShared = await (await oneAs("erika").GET(request("GET"), ctx(sharedBooking))).json();
    expect(stillShared.transaction.accountId).toBe(shared);
  });

  it("is invisible to another household, like shared accounts", async () => {
    expect((await listAs("dora").GET(request("GET", undefined, `?accountId=${shared}`))).status).toBe(404);
    expect((await oneAs("dora").GET(request("GET"), ctx(sharedBooking))).status).toBe(404);
    expect((await oneAs("dora").GET(request("GET"), ctx(maxBooking))).status).toBe(404);
  });
});

describe("shared accounts", () => {
  it("have bookings every member can read, change and delete", async () => {
    const changed = await oneAs("max").PATCH(request("PATCH", { amount: "-4,00" }), ctx(sharedBooking));
    expect(changed.status).toBe(200);
    expect((await changed.json()).transaction).toMatchObject({ amountCents: -400, createdByMe: false });
    expect((await oneAs("max").DELETE(request("DELETE"), ctx(sharedBooking))).status).toBe(200);
    expect((await oneAs("erika").GET(request("GET"), ctx(sharedBooking))).status).toBe(404);
  });
});

describe("own categories on bookings", () => {
  async function own(userId: string, input: Record<string, unknown>) {
    const result = await createCategories({ db }).createCategory(await caller(userId), { kind: "expense", ...input });
    if (!result.ok) throw new Error(result.reason);
    return result.category;
  }

  it("books household categories anywhere and personal ones only on the owner's private account", async () => {
    const pets = await own("max", { scope: "household", name: "Haustiere" });
    const hobby = await own("max", { scope: "personal", name: "Modellbau" });
    expect((await book("erika", booking(shared, { category: pets.key }))).id).toBeTruthy();
    expect((await book("max", booking(maxPrivate, { category: hobby.key }))).id).toBeTruthy();
    expect((await listAs("max").POST(request("POST", booking(shared, { category: hobby.key })))).status).toBe(400);
  });

  it("never lets another member or household use or attach someone else's category", async () => {
    const pets = await own("max", { scope: "household", name: "Haustiere" });
    const hobby = await own("max", { scope: "personal", name: "Modellbau" });
    const erikasPrivate = await createAccount("erika", "private", "Erikas Giro");
    expect((await listAs("erika").POST(request("POST", booking(erikasPrivate, { category: hobby.key })))).status).toBe(400);
    expect((await listAs("erika").POST(request("POST", booking(shared, { category: hobby.key })))).status).toBe(400);
    expect((await listAs("dora").POST(request("POST", booking(doras, { category: pets.key })))).status).toBe(400);
    expect((await oneAs("erika").PATCH(request("PATCH", { category: hobby.key }), ctx(sharedBooking))).status).toBe(400);
    // Max's personal booking stays invisible to Erika, also through its category.
    const withHobby = await book("max", booking(maxPrivate, { category: hobby.key }));
    expect((await oneAs("erika").GET(request("GET"), ctx(withHobby.id))).status).toBe(404);
  });
});
