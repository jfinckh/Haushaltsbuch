import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { householdsRoute } from "@/app/_lib/households-route";
import { createHouseholds } from "@/households/server";

let households: ReturnType<typeof createHouseholds>;

beforeEach(async () => {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../../../drizzle", import.meta.url).pathname });
  households = createHouseholds({ db });
});

function routeAs(userId: string | null) {
  return householdsRoute({ households, getUserId: async () => userId });
}

function post(body: unknown) {
  return new Request("http://localhost/api/households", { method: "POST", body: JSON.stringify(body) });
}

describe("/api/households", () => {
  it("needs a session", async () => {
    const route = routeAs(null);
    expect((await route.GET()).status).toBe(401);
    expect((await route.POST(post({ name: "A" }))).status).toBe(401);
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
});
