import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccounts, type Accounts } from "@/accounts/server";
import { createImportWorkflow } from "@/app/_lib/import-workflow";
import { importsRoute } from "@/app/_lib/imports-route";
import { transactionRoute } from "@/app/_lib/transactions-route";
import { proposalRoute, transferRoute, transfersRoute } from "@/app/_lib/transfers-route";
import { createHouseholds } from "@/households/server";
import { createImports, type Imports } from "@/import/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import { withSession, type Caller, type RlsDatabase } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createTransactions, type Transactions } from "@/transactions/server";
import { createTransfers, type Transfers } from "@/transfers/server";

// Privacy tests for every transfers route: a member never sees, links, unlinks or changes another
// member's private bookings or pairs, a hidden partner is described only by its owner, and another
// household sees nothing. Plus the test data from docs/konzept.md ("Testdaten"), imported through the
// import route, which starts the matching.

const ING = readFileSync(new URL("../../../../test-data/ing_testdaten.csv", import.meta.url));
const TR = readFileSync(new URL("../../../../test-data/traderepublic_testdaten.csv", import.meta.url));
const MEMBERS = [
  { userId: "max", name: "Max Mustermann" },
  { userId: "erika", name: "Erika Mustermann" },
];

let db: RlsDatabase;
let accounts: Accounts;
let transactions: Transactions;
let imports: Imports;
let transfers: Transfers;
let callers: Map<string, Promise<Caller>>;

function sessionOf(userId: string | null) {
  return async () => {
    if (userId === null) return null;
    if (!callers.has(userId)) callers.set(userId, createTestSession(db, userId));
    return callers.get(userId)!;
  };
}

const caller = async (userId: string) => (await sessionOf(userId)())!;
const deps = (userId: string | null) => ({ transfers, members: async () => MEMBERS, getCaller: sessionOf(userId) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://localhost/api/transfers/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const overviewAs = (userId: string | null, accountId: string) =>
  transfersRoute(deps(userId)).GET(new Request(`http://localhost/api/transfers?accountId=${accountId}`));
const statusAs = (userId: string | null, id: string) => transferRoute(deps(userId)).GET(new Request("http://localhost/api/transfers/x"), ctx(id));
const actAs = (userId: string | null, id: string, body: unknown) => transferRoute(deps(userId)).POST(post(body), ctx(id));
const proposalAs = (userId: string | null, pairId: string, body: unknown) => proposalRoute(deps(userId)).POST(post(body), ctx(pairId));

async function importFile(userId: string, accountId: string, bytes: Buffer) {
  const body = new FormData();
  body.set("accountId", accountId);
  body.set("file", new File([new Uint8Array(bytes)], "export.csv", { type: "text/csv" }));
  const route = importsRoute({
    imports,
    accounts,
    getCaller: sessionOf(userId),
    workflow: createImportWorkflow({ imports, transfers, householdMembers: async () => MEMBERS }),
  });
  const response = await route.POST(new Request("http://localhost/api/imports", { method: "POST", body }));
  expect(response.status).toBe(201);
  return response.json();
}

async function createAccount(userId: string, visibility: "private" | "shared", name: string, extra: Record<string, unknown> = {}) {
  const result = await accounts.createAccount(await caller(userId), {
    name,
    bank: "ing",
    type: "checking",
    visibility,
    openingBalance: "0",
    ...extra,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.accounts[0].id;
}

/** The id of the visible booking with this date and amount. */
async function bookingId(userId: string, accountId: string, date: string, amountCents: number) {
  const listed = await transactions.listTransactions(await caller(userId), { accountId, from: date, to: date });
  if (!listed.ok) throw new Error(listed.reason);
  return listed.transactions.find((t) => t.amountCents === amountCents)!.id;
}

let maxIng: string;
let maxTr: string;
let shared: string;
let erikas: string;
let doras: string;

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
  transactions = createTransactions({ db, crypto });
  imports = createImports({ db, crypto, transactions, setOpeningBalance: accounts.setOpeningBalance });
  transfers = createTransfers({ db, crypto, transactions, today: () => "2026-10-21" });
  const households = createHouseholds({ db, householdHoldsData: accounts.householdHasSharedAccounts });
  await households.createHousehold(await caller("max"), { name: "Mustermann" });
  await households.joinInvitersHousehold(await caller("erika"), { inviterId: "max", invitedAt: new Date() });
  await households.createHousehold(await caller("dora"), { name: "Other" });

  maxIng = await createAccount("max", "private", "ING Giro", { iban: "DE94 1234 5678 1111 1111 11" });
  maxTr = await createAccount("max", "private", "TR Verrechnungskonto", { bank: "trade_republic", type: "clearing" });
  shared = await createAccount("erika", "shared", "Gemeinschaftskonto");
  erikas = await createAccount("erika", "private", "Erikas Giro");
  doras = await createAccount("dora", "shared", "Doras");
});

/** Imports both test files; returns the linked ING −1.000 € booking. */
async function importTestData() {
  const first = await importFile("max", maxIng, ING);
  const second = await importFile("max", maxTr, TR);
  return { first, second };
}

/** Erika's shared account receives the September rent from Max (as if she imported its export). */
async function sharedRent() {
  const erika = await caller("erika");
  const [id] = await withSession(db, erika, (tx, userId) =>
    transactions.insertBookings(tx, userId, [
      {
        accountId: shared,
        bookingDate: "2026-09-01",
        amountCents: 120000,
        kind: "income",
        category: null,
        counterparty: "Max Mustermann",
        counterpartyIban: null,
        reference: "Miete und co",
      },
    ]),
  );
  await transfers.matchAfterImport(erika, { bookingIds: [id], members: MEMBERS });
  return id;
}

/** Accepts, through the route, every proposal on the account that `userId` can decide on. */
async function acceptAllAs(userId: string, accountId: string) {
  const overview = await (await overviewAs(userId, accountId)).json();
  for (const proposal of overview.proposals) {
    expect((await proposalAs(userId, proposal.pairId, { action: "accept" })).status).toBe(200);
  }
  return overview.proposals.length;
}

/** A private booking of Erika's that Max may not see, and Max's booking naming her with the opposite amount. */
async function erikasSalaryAndMaxsProbe(amountCents = 312345) {
  const erika = await caller("erika");
  const max = await caller("max");
  const booking = (accountId: string, cents: number, counterparty: string) => ({
    accountId,
    bookingDate: "2026-10-01",
    amountCents: cents,
    kind: cents < 0 ? ("expense" as const) : ("income" as const),
    category: null,
    counterparty,
    counterpartyIban: null,
    reference: null,
  });
  const [salary] = await withSession(db, erika, (tx, userId) => transactions.insertBookings(tx, userId, [booking(erikas, 312345, "Arbeitgeber GmbH")]));
  await transfers.matchAfterImport(erika, { bookingIds: [salary], members: MEMBERS });
  const [probe] = await withSession(db, max, (tx, userId) => transactions.insertBookings(tx, userId, [booking(maxIng, -amountCents, "Erika Mustermann")]));
  const result = await transfers.matchAfterImport(max, { bookingIds: [probe], members: MEMBERS });
  return { salary, probe, result };
}

describe("test data through the import route", () => {
  it("links the two ING → Trade Republic transfers and keeps the balance at 703,26 €", async () => {
    const { first, second } = await importTestData();
    expect(first.transfers).toEqual({ linked: 0, proposed: 0 });
    expect(second.transfers).toEqual({ linked: 2, proposed: 0 });

    const status = await (await statusAs("max", await bookingId("max", maxIng, "2026-10-14", -100000))).json();
    expect(status.status.link).toMatchObject({ status: "linked", manual: false, partner: { visible: true, booking: { accountId: maxTr, date: "2026-10-15", amountCents: 100000 } } });
    expect(status.status.booking.kind).toBe("transfer");

    const account = (await accounts.getAccount(await caller("max"), maxIng))!;
    expect(account.openingBalanceCents + (await transactions.balances(await caller("max")))[maxIng]).toBe(70326);
  });

  it("lists the open transfers of the ING account", async () => {
    await importTestData();
    const response = await overviewAs("max", maxIng);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.open.map((b: { date: string; amountCents: number }) => `${b.date} ${b.amountCents}`).sort()).toEqual([
      "2026-09-01 -120000",
      "2026-09-15 50000",
      "2026-10-01 -120000",
      "2026-10-05 15000",
      "2026-10-15 -20000",
    ]);
  });

  it("marks the 500 € from Max as a transfer from an external own account", async () => {
    await importTestData();
    const id = await bookingId("max", maxIng, "2026-09-15", 50000);
    const response = await actAs("max", id, { action: "no-partner", target: { type: "external" } });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toMatchObject({ open: false, decision: { type: "no-partner", target: "external" } });
  });

  it("links the rent to the shared account once Max accepts, and shows Erika only who it came from", async () => {
    await importTestData();
    const sharedId = await sharedRent();
    expect((await (await statusAs("erika", sharedId)).json()).status).toMatchObject({ link: null, proposals: [] });
    expect(await acceptAllAs("max", maxIng)).toBe(1);
    const maxRent = await bookingId("max", maxIng, "2026-09-01", -120000);

    const erikaView = await statusAs("erika", sharedId);
    expect(erikaView.status).toBe(200);
    const text = await erikaView.text();
    expect(JSON.parse(text).status.link).toMatchObject({ status: "linked", partner: { visible: false, ownerName: "Max Mustermann" } });
    expect(text).not.toContain('"max"');
    expect(text).not.toContain(maxRent);
    expect(text).not.toContain(maxIng);

    const maxView = await (await statusAs("max", maxRent)).json();
    expect(maxView.status.link.partner).toMatchObject({ visible: true, booking: { id: sharedId, accountId: shared } });
  });
});

describe("/api/transfers privacy", () => {
  it("needs a session", async () => {
    expect((await overviewAs(null, maxIng)).status).toBe(401);
    expect((await statusAs(null, "x")).status).toBe(401);
    expect((await actAs(null, "x", { action: "unlink" })).status).toBe(401);
    expect((await proposalAs(null, "x", { action: "accept" })).status).toBe(401);
  });

  it("gives Erika 404 for Max's private account, bookings and pairs, and changes nothing", async () => {
    await importTestData();
    const id = await bookingId("max", maxIng, "2026-10-14", -100000);
    const partner = await bookingId("max", maxTr, "2026-10-15", 100000);
    const pairId = (await (await statusAs("max", id)).json()).status.link.pairId;

    expect((await overviewAs("erika", maxIng)).status).toBe(404);
    expect((await statusAs("erika", id)).status).toBe(404);
    for (const body of [
      { action: "unlink" },
      { action: "link", partnerId: partner },
      { action: "set-kind", kind: "expense" },
      { action: "no-partner", target: { type: "external" } },
    ]) {
      expect((await actAs("erika", id, body)).status).toBe(404);
    }
    expect((await proposalAs("erika", pairId, { action: "reject" })).status).toBe(404);
    expect((await proposalAs("erika", pairId, { action: "accept" })).status).toBe(404);

    const after = (await (await statusAs("max", id)).json()).status;
    expect(after).toMatchObject({ link: { pairId, status: "linked" }, booking: { kind: "transfer" } });
  });

  it("does not let Erika link her shared booking to Max's private one", async () => {
    await importTestData();
    const sharedId = await sharedRent();
    const maxRent = await bookingId("max", maxIng, "2026-10-01", -120000);
    expect((await actAs("erika", sharedId, { action: "link", partnerId: maxRent })).status).toBe(404);
  });

  it("lets Erika unlink the shared side; Max's side is open again", async () => {
    await importTestData();
    const sharedId = await sharedRent();
    await acceptAllAs("max", maxIng);
    expect((await actAs("erika", sharedId, { action: "unlink" })).status).toBe(200);
    const maxRent = await bookingId("max", maxIng, "2026-09-01", -120000);
    expect((await (await statusAs("max", maxRent)).json()).status).toMatchObject({ link: null, open: true });
  });

  it("tells Max nothing about Erika's private booking with the amount he guessed, and leaves it unchanged", async () => {
    const { salary, probe, result } = await erikasSalaryAndMaxsProbe();
    expect(result).toEqual({ linked: 0, proposed: 0 });
    const text = await (await statusAs("max", probe)).text();
    expect(JSON.parse(text).status).toMatchObject({ link: null, proposals: [], open: true });
    expect(text).not.toContain(salary);
    expect(text).not.toContain("erika");
    expect((await (await overviewAs("max", maxIng)).json()).proposals).toEqual([]);
    expect((await (await statusAs("erika", salary)).json()).status.booking.kind).toBe("income");
  });

  it("lets only Erika decide on the proposal for her private booking", async () => {
    const { salary, probe } = await erikasSalaryAndMaxsProbe();
    const overview = await (await overviewAs("erika", erikas)).json();
    expect(overview.proposals).toHaveLength(1);
    expect(overview.proposals[0].partner).toEqual({ visible: false, ownerName: "Max Mustermann" });
    const pairId = overview.proposals[0].pairId;
    expect((await proposalAs("max", pairId, { action: "accept" })).status).toBe(404);
    expect((await proposalAs("max", pairId, { action: "reject" })).status).toBe(404);
    expect((await proposalAs("dora", pairId, { action: "accept" })).status).toBe(404);
    expect((await proposalAs("erika", pairId, { action: "accept" })).status).toBe(200);
    expect((await (await statusAs("erika", salary)).json()).status.booking.kind).toBe("transfer");
    expect((await (await statusAs("max", probe)).json()).status.link).toMatchObject({ status: "linked", partner: { visible: false } });
  });

  it("gives another household nothing", async () => {
    await importTestData();
    expect((await overviewAs("dora", maxIng)).status).toBe(404);
    expect((await overviewAs("dora", shared)).status).toBe(404);
    expect((await overviewAs("erika", doras)).status).toBe(404);
    expect((await statusAs("dora", await bookingId("max", maxIng, "2026-10-14", -100000))).status).toBe(404);
  });

  it("rejects invalid input", async () => {
    await importTestData();
    const id = await bookingId("max", maxIng, "2026-10-15", -20000);
    expect((await transfersRoute(deps("max")).GET(new Request("http://localhost/api/transfers"))).status).toBe(400);
    expect((await actAs("max", id, { action: "explode" })).status).toBe(400);
    expect((await actAs("max", id, { action: "set-kind", kind: "gift" })).status).toBe(400);
    expect((await actAs("max", id, { action: "no-partner", target: { type: "account", accountId: erikas } })).status).toBe(400);
    expect((await proposalAs("max", "x", { action: "maybe" })).status).toBe(400);
  });
});

describe("manual corrections through the routes", () => {
  it("links an open transfer to a booking chosen from the candidates", async () => {
    await importTestData();
    const out = await bookingId("max", maxIng, "2026-10-15", -20000);
    const created = await transactions.createTransaction(await caller("max"), {
      accountId: maxTr,
      date: "2026-10-16",
      amount: "200,00",
      kind: "income",
    });
    if (!created.ok) throw new Error(created.reason);
    const status = (await (await statusAs("max", out)).json()).status;
    expect(status.candidates.map((c: { id: string }) => c.id)).toContain(created.transaction.id);
    const linked = await actAs("max", out, { action: "link", partnerId: created.transaction.id });
    expect(linked.status).toBe(200);
    expect((await linked.json()).status.link).toMatchObject({ manual: true, partner: { booking: { id: created.transaction.id } } });
  });

  it("accepts a proposal once; a second accept finds nothing", async () => {
    await importFile("max", maxIng, ING);
    const erika = await caller("erika");
    const [proposed] = await withSession(db, erika, (tx, userId) =>
      transactions.insertBookings(tx, userId, [
        { accountId: shared, bookingDate: "2026-10-16", amountCents: 20000, kind: "income", category: null, counterparty: null, counterpartyIban: null, reference: null },
      ]),
    );
    // Max's side is private, so the proposal waits for Max; Erika learns nothing of it.
    expect(await transfers.matchAfterImport(erika, { bookingIds: [proposed], members: MEMBERS })).toEqual({ linked: 0, proposed: 0 });
    expect((await (await overviewAs("erika", shared)).json()).proposals).toEqual([]);
    const overview = await (await overviewAs("max", maxIng)).json();
    expect(overview.proposals).toHaveLength(1);
    expect(overview.proposals[0].partner).toMatchObject({ visible: true, booking: { id: proposed, accountId: shared } });
    const pairId = overview.proposals[0].pairId;
    expect((await proposalAs("erika", pairId, { action: "accept" })).status).toBe(404);
    expect((await proposalAs("max", pairId, { action: "accept" })).status).toBe(200);
    expect((await proposalAs("max", pairId, { action: "accept" })).status).toBe(404);
  });

  it("changing the type in the booking form to expense unlinks the transfer", async () => {
    await importTestData();
    const id = await bookingId("max", maxIng, "2026-10-14", -100000);
    const patch = await transactionRoute({ transactions, transfers, getCaller: sessionOf("max") }).PATCH(
      new Request("http://localhost/api/transactions/x", { method: "PATCH", body: JSON.stringify({ kind: "expense" }) }),
      ctx(id),
    );
    expect(patch.status).toBe(200);
    expect((await patch.json()).transaction.kind).toBe("expense");
    const status = (await (await statusAs("max", id)).json()).status;
    expect(status).toMatchObject({ link: null, open: false, decision: { type: "kind", kind: "expense" } });
  });
});
