import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { householdMembershipRoute, householdsRoute } from "@/app/_lib/households-route";
import { createHouseholds } from "@/households/server";
import type { Caller, RlsDatabase } from "@/shared/rls";
import { createTestSession, endTestSessions } from "@/shared/test-sessions";

let households: ReturnType<typeof createHouseholds>;
let db: RlsDatabase;
let callers: Map<string, Promise<Caller>>;

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite() });
  await migrate(pglite, { migrationsFolder: new URL("../../../../drizzle", import.meta.url).pathname });
  db = pglite;
  households = createHouseholds({ db });
  callers = new Map();
});

/** The signed-in session of `userId` (one per user), or nobody for null. */
function sessionOf(userId: string | null) {
  return async () => {
    if (userId === null) return null;
    if (!callers.has(userId)) callers.set(userId, createTestSession(db, userId));
    return callers.get(userId)!;
  };
}

function routeAs(userId: string | null) {
  return householdsRoute({ households, getCaller: sessionOf(userId) });
}

function membershipAs(userId: string | null) {
  return householdMembershipRoute({ households, getCaller: sessionOf(userId) });
}

function post(body: unknown) {
  return new Request("http://localhost/api/households", { method: "POST", body: JSON.stringify(body) });
}

function patch(body: unknown, query = "") {
  return new Request(`http://localhost/api/households${query}`, { method: "PATCH", body: JSON.stringify(body) });
}

describe("/api/households", () => {
  it("needs a session", async () => {
    const route = routeAs(null);
    expect((await route.GET()).status).toBe(401);
    expect((await route.POST(post({ name: "A" }))).status).toBe(401);
    expect((await route.PATCH(patch({ name: "A" }))).status).toBe(401);
    expect((await membershipAs(null).DELETE()).status).toBe(401);
  });

  it("answers 401 once the session has ended", async () => {
    const route = routeAs("max");
    await route.POST(post({ name: "A" }));
    await endTestSessions(db, "max");
    expect((await route.GET()).status).toBe(401);
  });

  it("creates the caller's household once", async () => {
    const route = routeAs("max");
    const created = await route.POST(post({ name: "Mustermann" }));
    expect(created.status).toBe(201);
    expect((await created.json()).household).toMatchObject({ name: "Mustermann", memberCount: 1 });
    expect((await route.POST(post({ name: "Again" }))).status).toBe(409);
  });

  it("rejects invalid input", async () => {
    expect((await routeAs("max").POST(post({ name: " " }))).status).toBe(400);
    const broken = new Request("http://localhost/api/households", { method: "POST", body: "{" });
    expect((await routeAs("max").POST(broken)).status).toBe(400);
  });

  it("returns only the caller's own household", async () => {
    await routeAs("max").POST(post({ name: "A" }));
    await routeAs("dora").POST(post({ name: "B" }));

    expect((await (await routeAs("max").GET()).json()).household.name).toBe("A");
    expect((await (await routeAs("dora").GET()).json()).household.name).toBe("B");
    expect((await routeAs("stranger").GET()).status).toBe(404);
  });

  it("renames only the caller's own household", async () => {
    await routeAs("max").POST(post({ name: "A" }));
    const b = await (await routeAs("dora").POST(post({ name: "B" }))).json();

    // An id for dora's household in body or query is ignored.
    const res = await routeAs("max").PATCH(patch({ name: "Renamed", id: b.household.id }, `?id=${b.household.id}`));
    expect(res.status).toBe(200);
    expect((await res.json()).household).toMatchObject({ name: "Renamed", memberCount: 1 });
    expect((await households.getHousehold((await sessionOf("dora")())!))?.name).toBe("B");
  });

  it("rejects invalid renames and callers without a household", async () => {
    await routeAs("max").POST(post({ name: "A" }));
    expect((await routeAs("max").PATCH(patch({ name: "" }))).status).toBe(400);
    expect((await routeAs("stranger").PATCH(patch({ name: "X" }))).status).toBe(404);
  });
});

describe("/api/households/membership", () => {
  it("lets a member leave; the last one deletes the household", async () => {
    await routeAs("max").POST(post({ name: "A" }));
    await households.joinInvitersHousehold((await sessionOf("erika")())!, { inviterId: "max", invitedAt: new Date() });

    const first = await membershipAs("erika").DELETE();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ householdDeleted: false });
    expect((await routeAs("erika").GET()).status).toBe(404);

    expect(await (await membershipAs("max").DELETE()).json()).toEqual({ householdDeleted: true });
    expect((await routeAs("max").GET()).status).toBe(404);
  });

  it("never removes anyone from another household", async () => {
    await routeAs("max").POST(post({ name: "A" }));
    await routeAs("dora").POST(post({ name: "B" }));

    expect((await membershipAs("stranger").DELETE()).status).toBe(404);
    await membershipAs("max").DELETE();
    expect((await (await routeAs("dora").GET()).json()).household).toMatchObject({ name: "B", memberCount: 1 });
  });
});
