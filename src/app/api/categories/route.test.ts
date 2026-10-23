import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccounts } from "@/accounts/server";
import { categoriesRoute, categoryRoute, hiddenCategoriesRoute } from "@/app/_lib/categories-route";
import { createHouseholds } from "@/households/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import type { Caller, RlsDatabase } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createCategories, type Categories } from "@/transactions/server";

// Privacy tests for every categories route: a member never sees, renames or archives another
// member's personal categories (404 like an unknown id), household categories belong to every
// member, and another household reaches nothing.

let db: RlsDatabase;
let categories: Categories;
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
  new Request("http://localhost/api/categories", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const deps = (userId: string | null) => ({ categories, getCaller: sessionOf(userId) });
const listAs = (userId: string | null) => categoriesRoute(deps(userId)).GET();
const createAs = (userId: string | null, body: unknown) => categoriesRoute(deps(userId)).POST(jsonRequest("POST", body));
const patchAs = (userId: string | null, id: string, body: unknown) => categoryRoute(deps(userId)).PATCH(jsonRequest("PATCH", body), ctx(id));
const hideAs = (userId: string | null, body: unknown) => hiddenCategoriesRoute(deps(userId)).PUT(jsonRequest("PUT", body));

async function created(userId: string, body: Record<string, unknown>): Promise<{ id: string; key: string }> {
  const response = await createAs(userId, { kind: "expense", ...body });
  expect(response.status).toBe(201);
  return (await response.json()).category;
}

async function listedNames(userId: string) {
  const body = await (await listAs(userId)).json();
  const names = (scope: { categories: { name: string }[] } | null) => scope?.categories.map((c) => c.name) ?? null;
  return { household: names(body.household), personal: names(body.personal), hidden: body.household?.hidden ?? null };
}

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite() });
  db = pglite;
  await migrate(pglite, { migrationsFolder: new URL("../../../../drizzle", import.meta.url).pathname });
  callers = new Map();
  const crypto = createFieldCrypto({ keys: `1:${randomBytes(32).toString("base64")}`, indexKey: randomBytes(32).toString("base64") });
  const accounts = createAccounts({ db, crypto });
  categories = createCategories({ db });
  const households = createHouseholds({ db, householdHoldsData: accounts.householdHasSharedAccounts });
  await households.createHousehold(await caller("max"), { name: "Mustermann" });
  await households.joinInvitersHousehold(await caller("erika"), { inviterId: "max", invitedAt: new Date() });
  await households.createHousehold(await caller("dora"), { name: "Other" });
});

describe("/api/categories", () => {
  it("needs a session", async () => {
    expect((await listAs(null)).status).toBe(401);
    expect((await createAs(null, { scope: "household", kind: "expense", name: "X" })).status).toBe(401);
    expect((await patchAs(null, "x", { name: "X" })).status).toBe(401);
    expect((await hideAs(null, { scope: "household", key: "children", hidden: true })).status).toBe(401);
  });

  it("creates, renames, archives and restores, and hides standard keys", async () => {
    const pets = await created("max", { scope: "household", name: "Haustiere" });
    const renamed = await patchAs("erika", pets.id, { name: "Tiere" });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).category).toMatchObject({ id: pets.id, name: "Tiere", archived: false });
    expect((await (await patchAs("max", pets.id, { archived: true })).json()).category).toMatchObject({ archived: true });
    expect((await (await patchAs("max", pets.id, { archived: false })).json()).category).toMatchObject({ archived: false });
    expect((await hideAs("max", { scope: "household", key: "children", hidden: true })).status).toBe(200);
    expect(await listedNames("erika")).toEqual({ household: ["Tiere"], personal: [], hidden: ["children"] });
  });

  it("rejects invalid input with 400 and a second category of the same name with 409", async () => {
    expect((await createAs("max", { scope: "household", kind: "expense", name: "" })).status).toBe(400);
    expect((await createAs("max", null)).status).toBe(400);
    const pets = await created("max", { scope: "household", name: "Haustiere" });
    expect((await createAs("max", { scope: "household", kind: "expense", name: "haustiere" })).status).toBe(409);
    expect((await patchAs("max", pets.id, { name: "" })).status).toBe(400);
    expect((await patchAs("max", pets.id, { archived: "yes" })).status).toBe(400);
    expect((await patchAs("max", pets.id, null)).status).toBe(400);
    expect((await hideAs("max", { scope: "household", key: pets.key, hidden: true })).status).toBe(400);
  });

  it("never lets another member see or change a personal category", async () => {
    const hobby = await created("max", { scope: "personal", name: "Modellbau" });
    await hideAs("max", { scope: "personal", key: "children", hidden: true });
    expect(await listedNames("erika")).toEqual({ household: [], personal: [], hidden: [] });
    expect((await patchAs("erika", hobby.id, { name: "X" })).status).toBe(404);
    expect((await patchAs("erika", hobby.id, { archived: true })).status).toBe(404);
    expect((await createAs("erika", { scope: "personal", kind: "expense", parentKey: hobby.key, name: "X" })).status).toBe(400);
    const ofMax = await (await listAs("max")).json();
    expect(ofMax.personal).toMatchObject({ hidden: ["children"], categories: [{ name: "Modellbau", archived: false }] });
    const raw = JSON.stringify(await (await listAs("erika")).json());
    expect(raw).not.toContain("Modellbau");
    expect(raw).not.toContain(hobby.id);
  });

  it("never lets another household see or change the household's categories", async () => {
    const pets = await created("max", { scope: "household", name: "Haustiere" });
    await hideAs("max", { scope: "household", key: "children", hidden: true });
    expect(await listedNames("dora")).toEqual({ household: [], personal: [], hidden: [] });
    expect((await patchAs("dora", pets.id, { name: "X" })).status).toBe(404);
    expect((await patchAs("dora", pets.id, { archived: true })).status).toBe(404);
    expect((await createAs("dora", { scope: "household", kind: "expense", parentKey: pets.key, name: "X" })).status).toBe(400);
    expect(await listedNames("max")).toEqual({ household: ["Haustiere"], personal: [], hidden: ["children"] });
  });
});
