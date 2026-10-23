import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccounts, type Accounts } from "@/accounts/server";
import { budgetRoute, budgetsRoute } from "@/app/_lib/budgets-route";
import { createBudgets, type Budgets } from "@/budgets/server";
import { createHouseholds } from "@/households/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import type { Caller, RlsDatabase } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createCategories, createTransactions } from "@/transactions/server";

// Privacy tests for every budgets route: a member never creates, changes or deletes budgets of
// another member's private account (404 like an unknown id), shared accounts' budgets belong to
// every member, and another household reaches nothing.

let db: RlsDatabase;
let accounts: Accounts;
let budgets: Budgets;
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
  new Request("http://localhost/api/budgets", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const deps = (userId: string | null) => ({ budgets, getCaller: sessionOf(userId) });
const createAs = (userId: string | null, body: unknown) => budgetsRoute(deps(userId)).POST(jsonRequest("POST", body));
const updateAs = (userId: string | null, id: string, body: unknown) =>
  budgetRoute(deps(userId)).PATCH(jsonRequest("PATCH", body), ctx(id));
const deleteAs = (userId: string | null, id: string) => budgetRoute(deps(userId)).DELETE(jsonRequest("DELETE"), ctx(id));

async function created(userId: string, accountId: string, category = "groceries", limit = "400,00"): Promise<{ id: string }> {
  const response = await createAs(userId, { accountId, category, limit });
  expect(response.status).toBe(201);
  return (await response.json()).budget;
}

async function createAccount(userId: string, visibility: "private" | "shared", name: string) {
  const result = await accounts.createAccount(await caller(userId), { name, bank: "ing", type: "checking", visibility, openingBalance: "0" });
  if (!result.ok) throw new Error(result.reason);
  return result.accounts[0].id;
}

async function limitsOf(userId: string, accountId: string) {
  const listed = await budgets.listBudgets(await caller(userId), accountId);
  return listed.ok ? listed.budgets.map((b) => b.limitCents) : listed.reason;
}

let maxIng: string;
let shared: string;
let doras: string;

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite() });
  db = pglite;
  await migrate(pglite, { migrationsFolder: new URL("../../../../drizzle", import.meta.url).pathname });
  callers = new Map();
  const crypto = createFieldCrypto({ keys: `1:${randomBytes(32).toString("base64")}`, indexKey: randomBytes(32).toString("base64") });
  accounts = createAccounts({ db, crypto });
  budgets = createBudgets({ db, transactions: createTransactions({ db, crypto }) });
  const households = createHouseholds({ db, householdHoldsData: accounts.householdHasSharedAccounts });
  await households.createHousehold(await caller("max"), { name: "Mustermann" });
  await households.joinInvitersHousehold(await caller("erika"), { inviterId: "max", invitedAt: new Date() });
  await households.createHousehold(await caller("dora"), { name: "Other" });

  maxIng = await createAccount("max", "private", "ING Giro");
  shared = await createAccount("erika", "shared", "Gemeinschaftskonto");
  doras = await createAccount("dora", "shared", "Doras");
});

describe("/api/budgets", () => {
  it("needs a session", async () => {
    expect((await createAs(null, { accountId: maxIng, category: "groceries", limit: "1,00" })).status).toBe(401);
    expect((await updateAs(null, "x", { limit: "1,00" })).status).toBe(401);
    expect((await deleteAs(null, "x")).status).toBe(401);
  });

  it("creates, changes and deletes a budget", async () => {
    const { id } = await created("max", maxIng);
    const changed = await updateAs("max", id, { limit: "450,00" });
    expect(changed.status).toBe(200);
    expect((await changed.json()).budget).toMatchObject({ id, category: "groceries", limitCents: 45000, spentCents: 0 });
    expect((await deleteAs("max", id)).status).toBe(200);
    expect((await deleteAs("max", id)).status).toBe(404);
  });

  it("rejects invalid input with 400 and a second budget for the same category with 409", async () => {
    expect((await createAs("max", { accountId: maxIng, category: "salary", limit: "1,00" })).status).toBe(400);
    expect((await createAs("max", { accountId: maxIng, category: "groceries", limit: "0" })).status).toBe(400);
    expect((await createAs("max", null)).status).toBe(400);
    const { id } = await created("max", maxIng);
    expect((await createAs("max", { accountId: maxIng, category: "groceries", limit: "1,00" })).status).toBe(409);
    expect((await updateAs("max", id, { limit: "nope" })).status).toBe(400);
  });
});

describe("privacy between members", () => {
  it("never lets Erika create, change or delete budgets of Max's private account, answering 404 like for unknown ids", async () => {
    const own = await created("max", maxIng);
    expect((await createAs("erika", { accountId: maxIng, category: "health", limit: "1,00" })).status).toBe(404);
    const update = await updateAs("erika", own.id, { limit: "1,00" });
    expect(update.status).toBe(404);
    expect(JSON.stringify(await update.json())).not.toContain("groceries");
    expect((await deleteAs("erika", own.id)).status).toBe(404);
    expect((await updateAs("erika", "unknown", { limit: "1,00" })).status).toBe(404);
    expect(await limitsOf("max", maxIng)).toEqual([40000]);
    expect(await limitsOf("erika", maxIng)).toBe("not-found");
  });

  it("lets both members manage the shared account's budgets, and no other household", async () => {
    const onShared = await created("max", shared);
    expect((await updateAs("erika", onShared.id, { limit: "300,00" })).status).toBe(200);
    expect((await updateAs("dora", onShared.id, { limit: "1,00" })).status).toBe(404);
    expect((await deleteAs("dora", onShared.id)).status).toBe(404);
    expect((await createAs("max", { accountId: doras, category: "groceries", limit: "1,00" })).status).toBe(404);
    expect(await limitsOf("max", shared)).toEqual([30000]);
    expect((await deleteAs("erika", onShared.id)).status).toBe(200);
  });
});

describe("/api/budgets with own categories", () => {
  async function own(userId: string, input: Record<string, unknown>) {
    const result = await createCategories({ db }).createCategory(await caller(userId), { kind: "expense", ...input });
    if (!result.ok) throw new Error(result.reason);
    return result.category;
  }

  it("budgets household categories anywhere and personal ones only on the owner's private account", async () => {
    const pets = await own("max", { scope: "household", name: "Haustiere" });
    const hobby = await own("max", { scope: "personal", name: "Modellbau" });
    expect((await createAs("erika", { accountId: shared, category: pets.key, limit: "50,00" })).status).toBe(201);
    expect((await createAs("max", { accountId: maxIng, category: hobby.key, limit: "50,00" })).status).toBe(201);
    expect((await createAs("max", { accountId: shared, category: hobby.key, limit: "50,00" })).status).toBe(400);
  });

  it("never lets another member or household budget someone else's category", async () => {
    const pets = await own("max", { scope: "household", name: "Haustiere" });
    const hobby = await own("max", { scope: "personal", name: "Modellbau" });
    expect((await createAs("erika", { accountId: shared, category: hobby.key, limit: "1,00" })).status).toBe(400);
    expect((await createAs("dora", { accountId: doras, category: pets.key, limit: "1,00" })).status).toBe(400);
  });
});
