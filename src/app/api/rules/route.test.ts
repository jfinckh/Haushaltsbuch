import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccounts, type Accounts } from "@/accounts/server";
import { importsRoute } from "@/app/_lib/imports-route";
import { applyRulesRoute, ruleRoute, rulesRoute } from "@/app/_lib/rules-route";
import { transactionRoute } from "@/app/_lib/transactions-route";
import { transferRoute } from "@/app/_lib/transfers-route";
import { createHouseholds } from "@/households/server";
import { createImports, type Imports } from "@/import/server";
import { createRules, type Rules } from "@/rules/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import { withSession, type Caller, type RlsDatabase } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createCategories, createTransactions, type Transactions } from "@/transactions/server";
import { createTransfers, type Transfers } from "@/transfers/server";

// Privacy tests for every rules route: a member never sees, changes, deletes or applies another
// member's private rules, never creates rules on another member's private account, and another
// household sees nothing. Plus the ING test file through the import route: rules first, then
// transfer matching, and learning from corrections in the booking form and the transfer box.

const ING = readFileSync(new URL("../../../../test-data/ing_testdaten.csv", import.meta.url));
const MEMBERS = [
  { userId: "max", name: "Max Mustermann" },
  { userId: "erika", name: "Erika Mustermann" },
];

let db: RlsDatabase;
let accounts: Accounts;
let transactions: Transactions;
let imports: Imports;
let transfers: Transfers;
let rules: Rules;
let callers: Map<string, Promise<Caller>>;

function sessionOf(userId: string | null) {
  return async () => {
    if (userId === null) return null;
    if (!callers.has(userId)) callers.set(userId, createTestSession(db, userId));
    return callers.get(userId)!;
  };
}

const caller = async (userId: string) => (await sessionOf(userId)())!;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (method: string, body?: unknown) =>
  new Request("http://localhost/api/rules", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const deps = (userId: string | null) => ({
  rules,
  getCaller: sessionOf(userId),
  afterApply: async (c: Caller, ruleTransfers: { id: string; target: "external" | null }[]) =>
    transfers.matchAfterImport(c, { bookingIds: ruleTransfers.map((r) => r.id), members: MEMBERS, ruleTransfers }),
});
const listAs = (userId: string | null) => rulesRoute(deps(userId)).GET();
const createAs = (userId: string | null, body: unknown) => rulesRoute(deps(userId)).POST(jsonRequest("POST", body));
const getAs = (userId: string | null, id: string) => ruleRoute(deps(userId)).GET(jsonRequest("GET"), ctx(id));
const updateAs = (userId: string | null, id: string, body: unknown) => ruleRoute(deps(userId)).PATCH(jsonRequest("PATCH", body), ctx(id));
const deleteAs = (userId: string | null, id: string) => ruleRoute(deps(userId)).DELETE(jsonRequest("DELETE"), ctx(id));
const applyAs = (userId: string | null, accountId: string) => applyRulesRoute(deps(userId)).POST(jsonRequest("POST", { accountId }));
const patchBookingAs = (userId: string, id: string, body: unknown) =>
  transactionRoute({ transactions, transfers, rules, getCaller: sessionOf(userId) }).PATCH(jsonRequest("PATCH", body), ctx(id));
const transferActAs = (userId: string, id: string, body: unknown) =>
  transferRoute({ transfers, rules, getCaller: sessionOf(userId) }).POST(jsonRequest("POST", body), ctx(id));

const rule = (accountId: string, overrides: Record<string, unknown> = {}) => ({
  scope: { type: "account", accountId },
  counterparty: "REWE",
  kind: "expense",
  category: "groceries.supermarket",
  ...overrides,
});

async function created(userId: string, body: unknown): Promise<{ id: string }> {
  const response = await createAs(userId, body);
  expect(response.status).toBe(201);
  return (await response.json()).rule;
}

async function importFile(userId: string, accountId: string, bytes: Buffer = ING) {
  const body = new FormData();
  body.set("accountId", accountId);
  body.set("file", new File([new Uint8Array(bytes)], "export.csv", { type: "text/csv" }));
  const route = importsRoute({
    imports,
    accounts,
    transactions,
    getCaller: sessionOf(userId),
    applyRules: (c, bookingIds) => rules.applyToBookings(c, bookingIds),
    afterImport: (c, bookingIds, ruleTransfers) => transfers.matchAfterImport(c, { bookingIds, members: MEMBERS, ruleTransfers }),
  });
  const response = await route.POST(new Request("http://localhost/api/imports", { method: "POST", body }));
  expect(response.status).toBe(201);
  return response.json();
}

async function createAccount(userId: string, visibility: "private" | "shared", name: string) {
  const result = await accounts.createAccount(await caller(userId), { name, bank: "ing", type: "checking", visibility, openingBalance: "0" });
  if (!result.ok) throw new Error(result.reason);
  return result.accounts[0].id;
}

async function bookings(userId: string, accountId: string) {
  const listed = await transactions.listTransactions(await caller(userId), { accountId, from: "2026-09-01", to: "2026-10-31" });
  if (!listed.ok) throw new Error(listed.reason);
  return listed.transactions;
}

let maxIng: string;
let shared: string;
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
  imports = createImports({ db, crypto, transactions });
  transfers = createTransfers({ db, crypto, transactions, today: () => "2026-10-21" });
  rules = createRules({ db, crypto, transactions });
  const households = createHouseholds({ db, householdHoldsData: accounts.householdHasSharedAccounts });
  await households.createHousehold(await caller("max"), { name: "Mustermann" });
  await households.joinInvitersHousehold(await caller("erika"), { inviterId: "max", invitedAt: new Date() });
  await households.createHousehold(await caller("dora"), { name: "Other" });

  maxIng = await createAccount("max", "private", "ING Giro");
  shared = await createAccount("erika", "shared", "Gemeinschaftskonto");
  doras = await createAccount("dora", "shared", "Doras");
});

describe("/api/rules", () => {
  it("needs a session", async () => {
    expect((await listAs(null)).status).toBe(401);
    expect((await createAs(null, rule(maxIng))).status).toBe(401);
    expect((await getAs(null, "x")).status).toBe(401);
    expect((await updateAs(null, "x", rule(maxIng))).status).toBe(401);
    expect((await deleteAs(null, "x")).status).toBe(401);
    expect((await applyAs(null, maxIng)).status).toBe(401);
  });

  it("creates, reads, changes and deletes a rule", async () => {
    const { id } = await created("max", rule(maxIng));
    expect((await (await getAs("max", id)).json()).rule).toMatchObject({ counterparty: "REWE", createdByMe: true });
    const changed = await updateAs("max", id, rule(maxIng, { counterparty: "EDEKA" }));
    expect((await changed.json()).rule.counterparty).toBe("EDEKA");
    expect((await (await listAs("max")).json()).rules).toHaveLength(1);
    expect((await deleteAs("max", id)).status).toBe(200);
    expect((await getAs("max", id)).status).toBe(404);
  });

  it("rejects invalid input, and a shared rule without household", async () => {
    expect((await createAs("max", { scope: { type: "shared" } })).status).toBe(400);
    expect((await createAs("max", rule(maxIng, { counterparty: "" }))).status).toBe(400);
    expect((await applyAs("max", "")).status).toBe(400);
    const response = await createAs("solo", rule(maxIng, { scope: { type: "shared" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("no-household");
  });
});

describe("privacy between members", () => {
  it("never shows Erika Max's private rules, and answers 404 like for unknown ids", async () => {
    const onPrivate = await created("max", rule(maxIng));
    const ownWide = await created("max", rule(maxIng, { scope: { type: "private" } }));
    const onShared = await created("max", rule(shared));
    const listed = (await (await listAs("erika")).json()).rules as { id: string; createdByMe: boolean }[];
    expect(listed.map((r) => r.id)).toEqual([onShared.id]);
    expect(JSON.stringify(listed)).not.toContain("max");
    for (const id of [onPrivate.id, ownWide.id]) {
      expect((await getAs("erika", id)).status).toBe(404);
      expect((await updateAs("erika", id, rule(shared))).status).toBe(404);
      expect((await deleteAs("erika", id)).status).toBe(404);
    }
    expect((await getAs("erika", "unknown")).status).toBe(404);
    expect((await (await listAs("max")).json()).rules).toHaveLength(3);
  });

  it("lets Erika change and delete the shared account's rules", async () => {
    const onShared = await created("max", rule(shared));
    expect((await updateAs("erika", onShared.id, rule(shared, { counterparty: "dm" }))).status).toBe(200);
    expect((await deleteAs("erika", onShared.id)).status).toBe(200);
  });

  it("never lets Erika create rules on, or apply rules to, Max's private account", async () => {
    expect((await createAs("erika", rule(maxIng))).status).toBe(404);
    expect((await applyAs("erika", maxIng)).status).toBe(404);
    expect((await applyAs("erika", "unknown")).status).toBe(404);
  });

  it("gives another household nothing", async () => {
    await created("max", rule(shared));
    await created("max", rule(maxIng, { scope: { type: "shared" } }));
    expect((await (await listAs("dora")).json()).rules).toEqual([]);
    expect((await createAs("dora", rule(shared))).status).toBe(404);
    expect((await applyAs("dora", shared)).status).toBe(404);
    expect((await applyAs("max", doras)).status).toBe(404);
  });

  it("never lets Erika learn a rule from Max's private booking", async () => {
    await importFile("max", maxIng);
    const rewe = (await bookings("max", maxIng)).find((b) => b.counterparty === "VISA REWE MARKT GMBH")!;
    const response = await patchBookingAs("erika", rewe.id, { category: "groceries", rule: { field: "counterparty", pattern: "REWE" } });
    expect(response.status).toBe(404);
    expect((await (await listAs("max")).json()).rules).toEqual([]);
  });
});

describe("the ING test file through the import route", () => {
  it("applies the rules first, then links transfers, and keeps the balance at 703,26 €", async () => {
    await created("max", rule(maxIng));
    await created("max", rule(maxIng, { counterparty: null, reference: "spotify", category: "contracts.subscriptions" }));
    await created("max", rule(maxIng, { counterparty: null, reference: "Miete und co", kind: "transfer", category: null }));
    await created("max", rule(maxIng, { counterparty: "Erika Mustermann", kind: "income", category: "otherIncome" }));
    const result = await importFile("max", maxIng);
    expect(result.rules).toEqual({ applied: 6 });

    const all = await bookings("max", maxIng);
    expect(all.filter((b) => b.counterparty === "VISA REWE MARKT GMBH").map((b) => b.category)).toEqual([
      "groceries.supermarket",
      "groceries.supermarket",
    ]);
    expect(all.find((b) => b.reference?.includes("Spotify"))).toMatchObject({ category: "contracts.subscriptions", classifiedBy: "rule" });
    expect(all.filter((b) => b.reference === "Miete und co").every((b) => b.kind === "transfer")).toBe(true);
    const erikas = all.find((b) => b.counterparty === "Erika Mustermann")!;
    expect(erikas).toMatchObject({ kind: "income", category: "otherIncome" });
    expect((await transfers.statusOf(await caller("max"), erikas.id))?.open).toBe(false);

    const account = (await accounts.getAccount(await caller("max"), maxIng))!;
    expect(account.openingBalanceCents + (await transactions.balances(await caller("max")))[maxIng]).toBe(70326);
  });

  it("sorts older bookings without category on demand, and never what was set by hand", async () => {
    await importFile("max", maxIng);
    const edeka = (await bookings("max", maxIng)).filter((b) => b.counterparty === "VISA EDEKA MUSTERMARKT");
    await patchBookingAs("max", edeka[0].id, { category: "shopping" });
    await created("max", rule(maxIng, { counterparty: "edeka" }));
    const response = await applyAs("max", maxIng);
    expect(await response.json()).toEqual({ applied: 1 });
    const after = (await bookings("max", maxIng)).filter((b) => b.counterparty === "VISA EDEKA MUSTERMARKT");
    expect(after.map((b) => b.category).sort()).toEqual(["groceries.supermarket", "shopping"]);
  });

  it("marks the +500 € from Max as a transfer from an external own account, and leaves the rent open", async () => {
    await created("max", rule(maxIng, { counterparty: "Max Mustermann", amountSign: "positive", kind: "transfer", category: null, transferTarget: "external" }));
    await importFile("max", maxIng);
    const all = await bookings("max", maxIng);
    const own = all.find((b) => b.amountCents === 50000)!;
    expect(await transfers.statusOf(await caller("max"), own.id)).toMatchObject({ ruleTarget: "external", open: false, isTransfer: true });
    const rent = all.find((b) => b.reference === "Miete und co")!;
    expect(await transfers.statusOf(await caller("max"), rent.id)).toMatchObject({ ruleTarget: null, open: true });
  });
});

describe("learning from corrections", () => {
  it("creates a rule from the booking form's “Künftig immer so”", async () => {
    await importFile("max", maxIng);
    const spotify = (await bookings("max", maxIng)).find((b) => b.reference?.includes("Spotify"))!;
    const response = await patchBookingAs("max", spotify.id, {
      category: "contracts.subscriptions",
      rule: { field: "reference", pattern: "Spotify" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rule).toEqual({ created: true });
    expect(body.transaction).toMatchObject({ category: "contracts.subscriptions", classifiedBy: "manual" });
    const [learned] = (await (await listAs("max")).json()).rules;
    expect(learned).toMatchObject({
      scope: { type: "account", accountId: maxIng },
      reference: "Spotify",
      kind: "expense",
      category: "contracts.subscriptions",
    });
  });

  it("says when the rule could not be created, and keeps the change", async () => {
    await importFile("max", maxIng);
    const spotify = (await bookings("max", maxIng)).find((b) => b.reference?.includes("Spotify"))!;
    const response = await patchBookingAs("max", spotify.id, { category: "contracts", rule: { field: "counterparty", pattern: "Spotify" } });
    expect((await response.json()).rule).toEqual({ created: false });
    expect((await transactions.getTransaction(await caller("max"), spotify.id))?.category).toBe("contracts");
  });

  it("creates a rule from marking a transfer from an external own account", async () => {
    await importFile("max", maxIng);
    const own = (await bookings("max", maxIng)).find((b) => b.amountCents === 50000)!;
    const response = await transferActAs("max", own.id, {
      action: "no-partner",
      target: { type: "external" },
      rule: { field: "counterparty", pattern: "Max Mustermann" },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).rule).toEqual({ created: true });
    const [learned] = (await (await listAs("max")).json()).rules;
    expect(learned).toMatchObject({ counterparty: "Max Mustermann", kind: "transfer", transferTarget: "external" });
  });

  it("creates the shared account's rule for Erika, visible to Max too", async () => {
    const [id] = await withSession(db, await caller("erika"), (tx, userId) =>
      transactions.insertBookings(tx, userId, [
        {
          accountId: shared,
          bookingDate: "2026-10-05",
          amountCents: 15000,
          kind: "income",
          category: null,
          counterparty: "Erika Mustermann",
          counterpartyIban: null,
          reference: "Anteil Urlaub",
        },
      ]),
    );
    const response = await transferActAs("erika", id, {
      action: "no-partner",
      target: { type: "external" },
      rule: { field: "counterparty", pattern: "Erika Mustermann" },
    });
    expect((await response.json()).rule).toEqual({ created: true });
    const seenByMax = (await (await listAs("max")).json()).rules;
    expect(seenByMax).toHaveLength(1);
    expect(seenByMax[0]).toMatchObject({ scope: { type: "account", accountId: shared }, createdByMe: false });
  });
});

describe("/api/rules with own categories", () => {
  async function own(userId: string, input: Record<string, unknown>) {
    const result = await createCategories({ db }).createCategory(await caller(userId), { kind: "expense", ...input });
    if (!result.ok) throw new Error(result.reason);
    return result.category;
  }

  it("saves household categories in every scope and personal ones only for private accounts", async () => {
    const pets = await own("max", { scope: "household", name: "Haustiere" });
    const hobby = await own("max", { scope: "personal", name: "Modellbau" });
    expect((await createAs("erika", rule(shared, { category: pets.key }))).status).toBe(201);
    expect((await createAs("max", rule(maxIng, { category: hobby.key }))).status).toBe(201);
    expect((await createAs("max", { ...rule(maxIng, { category: hobby.key }), scope: { type: "private" } })).status).toBe(201);
    expect((await createAs("max", rule(shared, { category: hobby.key }))).status).toBe(400);
    expect((await createAs("max", { ...rule(maxIng, { category: hobby.key }), scope: { type: "shared" } })).status).toBe(400);
  });

  it("never lets another member or household use someone else's category", async () => {
    const pets = await own("max", { scope: "household", name: "Haustiere" });
    const hobby = await own("max", { scope: "personal", name: "Modellbau" });
    expect((await createAs("erika", rule(shared, { category: hobby.key }))).status).toBe(400);
    expect((await createAs("erika", { ...rule(shared, { category: hobby.key }), scope: { type: "private" } })).status).toBe(400);
    expect((await createAs("dora", rule(doras, { category: pets.key }))).status).toBe(400);
    const { id } = await created("max", rule(maxIng, { category: hobby.key }));
    expect((await getAs("erika", id)).status).toBe(404);
  });
});
