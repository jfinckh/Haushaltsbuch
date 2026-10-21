import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { accountRoute, accountsRoute } from "@/app/_lib/accounts-route";
import { createAccounts, type Accounts } from "@/accounts/server";
import { createHouseholds, type createHouseholds as CreateHouseholds } from "@/households/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import type { Caller, RlsDatabase } from "@/shared/rls";
import { createTestSession, endTestSessions } from "@/shared/test-sessions";

// Privacy tests for every accounts route: a member never receives, changes or learns about
// another member's private account, and another household sees nothing at all.

let db: RlsDatabase;
let accounts: Accounts;
let households: ReturnType<typeof CreateHouseholds>;
let callers: Map<string, Promise<Caller>>;

function sessionOf(userId: string | null) {
  return async () => {
    if (userId === null) return null;
    if (!callers.has(userId)) callers.set(userId, createTestSession(db, userId));
    return callers.get(userId)!;
  };
}

const caller = async (userId: string) => (await sessionOf(userId)())!;
const listAs = (userId: string | null) => accountsRoute({ accounts, getCaller: sessionOf(userId) });
const oneAs = (userId: string | null) => accountRoute({ accounts, getCaller: sessionOf(userId) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (method: string, body?: unknown) =>
  new Request("http://localhost/api/accounts", { method, body: body === undefined ? undefined : JSON.stringify(body) });

const IBAN = "DE89370400440532013000";
const giro = { name: "ING Giro", bank: "ing", type: "checking", visibility: "private", openingBalance: "1.234,56", iban: IBAN };
const joint = { name: "Gemeinschaftskonto", bank: "ing", type: "checking", visibility: "shared", openingBalance: "0" };

async function create(userId: string, body: unknown): Promise<{ id: string }> {
  const response = await listAs(userId).POST(request("POST", body));
  expect(response.status).toBe(201);
  return (await response.json()).accounts[0];
}

let privateId: string;
let sharedId: string;
let dorasId: string;

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite() });
  await migrate(pglite, { migrationsFolder: new URL("../../../../drizzle", import.meta.url).pathname });
  db = pglite;
  callers = new Map();
  accounts = createAccounts({
    db,
    crypto: createFieldCrypto({
      keys: `1:${randomBytes(32).toString("base64")}`,
      indexKey: randomBytes(32).toString("base64"),
    }),
  });
  households = createHouseholds({ db, householdHoldsData: accounts.householdHasSharedAccounts });
  await households.createHousehold(await caller("max"), { name: "Mustermann" });
  await households.joinInvitersHousehold(await caller("erika"), { inviterId: "max", invitedAt: new Date() });
  await households.createHousehold(await caller("dora"), { name: "Other" });

  privateId = (await create("max", giro)).id;
  sharedId = (await create("max", joint)).id;
  dorasId = (await create("dora", { ...joint, name: "Doras" })).id;
});

describe("/api/accounts", () => {
  it("needs a session", async () => {
    expect((await listAs(null).GET()).status).toBe(401);
    expect((await listAs(null).POST(request("POST", giro))).status).toBe(401);
    expect((await oneAs(null).GET(request("GET"), ctx(privateId))).status).toBe(401);
    expect((await oneAs(null).PATCH(request("PATCH", { name: "x" }), ctx(privateId))).status).toBe(401);
    expect((await oneAs(null).DELETE(request("DELETE"), ctx(privateId))).status).toBe(401);
  });

  it("answers 401 once the session has ended", async () => {
    const route = listAs("max");
    await endTestSessions(db, "max");
    expect((await route.GET()).status).toBe(401);
  });

  it("lists only accounts the caller may see", async () => {
    const names = async (userId: string) =>
      ((await (await listAs(userId).GET()).json()).accounts as { name: string }[]).map((a) => a.name).sort();
    expect(await names("max")).toEqual(["Gemeinschaftskonto", "ING Giro"]);
    expect(await names("erika")).toEqual(["Gemeinschaftskonto"]);
    expect(await names("dora")).toEqual(["Doras"]);
  });

  it("never sends the owner's user id or the stored ciphertext", async () => {
    const body = JSON.stringify(await (await listAs("erika").GET()).json());
    expect(body).not.toContain("max");
    expect(body).not.toContain("ownerUserId");
    expect(body).not.toContain("ibanEncrypted");
  });

  it("creates accounts and rejects invalid input", async () => {
    const response = await listAs("erika").POST(request("POST", { ...giro, name: "Erikas Giro" }));
    expect(response.status).toBe(201);
    expect((await response.json()).accounts[0]).toMatchObject({ ownedByMe: true, openingBalanceCents: 123456 });
    expect((await listAs("erika").POST(request("POST", { ...giro, openingBalance: "1.5" }))).status).toBe(400);
    const broken = new Request("http://localhost/api/accounts", { method: "POST", body: "{" });
    expect((await listAs("erika").POST(broken)).status).toBe(400);
  });

  it("refuses shared accounts without a household", async () => {
    expect((await listAs("lone").POST(request("POST", joint))).status).toBe(409);
  });
});

describe("/api/accounts/[id]: another member's private account", () => {
  const notFound = { error: "Not found" };

  async function expectHidden(response: Response) {
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(notFound);
  }

  it("cannot be read, changed or deleted, and looks like an unknown id", async () => {
    for (const id of [privateId, "unknown-id", crypto.randomUUID()]) {
      await expectHidden(await oneAs("erika").GET(request("GET"), ctx(id)));
      await expectHidden(await oneAs("erika").PATCH(request("PATCH", { name: "Mine" }), ctx(id)));
      await expectHidden(await oneAs("erika").PATCH(request("PATCH", { visibility: "shared" }), ctx(id)));
      await expectHidden(await oneAs("erika").PATCH(request("PATCH", { archived: true }), ctx(id)));
      await expectHidden(await oneAs("erika").DELETE(request("DELETE"), ctx(id)));
    }
    // Invalid input does not tell it apart either: it is rejected the same way for any id.
    const invalid = { openingBalance: "1.5" };
    expect((await oneAs("erika").PATCH(request("PATCH", invalid), ctx(privateId))).status).toBe(400);
    expect((await oneAs("erika").PATCH(request("PATCH", invalid), ctx("unknown-id"))).status).toBe(400);

    const response = await oneAs("max").GET(request("GET"), ctx(privateId));
    expect((await response.json()).account).toMatchObject({
      name: "ING Giro",
      openingBalanceCents: 123456,
      iban: "DE89 3704 0044 0532 0130 00",
      archived: false,
    });
  });

  it("is hidden from another household, like shared ones", async () => {
    for (const id of [privateId, sharedId]) {
      await expectHidden(await oneAs("dora").GET(request("GET"), ctx(id)));
      await expectHidden(await oneAs("dora").PATCH(request("PATCH", { name: "x" }), ctx(id)));
      await expectHidden(await oneAs("dora").DELETE(request("DELETE"), ctx(id)));
    }
    await expectHidden(await oneAs("max").GET(request("GET"), ctx(dorasId)));
  });
});

describe("/api/accounts/[id]: shared accounts", () => {
  it("can be changed by every member, but made private only by its owner", async () => {
    const renamed = await oneAs("erika").PATCH(request("PATCH", { name: "Haushalt" }), ctx(sharedId));
    expect(renamed.status).toBe(200);
    expect((await oneAs("erika").PATCH(request("PATCH", { visibility: "private" }), ctx(sharedId))).status).toBe(403);

    const madePrivate = await oneAs("max").PATCH(request("PATCH", { visibility: "private" }), ctx(sharedId));
    expect((await madePrivate.json()).account).toMatchObject({ name: "Haushalt", visibility: "private" });
    expect((await oneAs("erika").GET(request("GET"), ctx(sharedId))).status).toBe(404);
  });

  it("can be archived and deleted by every member", async () => {
    const archived = await oneAs("erika").PATCH(request("PATCH", { archived: true }), ctx(sharedId));
    expect((await archived.json()).account.archived).toBe(true);
    expect((await oneAs("erika").DELETE(request("DELETE"), ctx(sharedId))).status).toBe(200);
    expect((await oneAs("max").GET(request("GET"), ctx(sharedId))).status).toBe(404);
  });
});

describe("switching and leaving households", () => {
  it("keeps a household with shared accounts when its only member is invited elsewhere", async () => {
    const result = await households.joinInvitersHousehold(await caller("dora"), { inviterId: "max", invitedAt: new Date() });
    expect(result).toMatchObject({ keptOwnHousehold: true, keptReason: "holds-data" });
  });

  it("moves a member with only private accounts, and the accounts come along", async () => {
    await oneAs("dora").DELETE(request("DELETE"), ctx(dorasId));
    const dorasPrivate = await create("dora", { ...giro, name: "Doras Giro" });
    const result = await households.joinInvitersHousehold(await caller("dora"), { inviterId: "max", invitedAt: new Date() });
    expect(result).toMatchObject({ keptOwnHousehold: false, keptReason: null });
    expect((await oneAs("dora").GET(request("GET"), ctx(dorasPrivate.id))).status).toBe(200);
    expect((await oneAs("max").GET(request("GET"), ctx(dorasPrivate.id))).status).toBe(404);
  });

  it("keeps the leaver's private accounts, and the household keeps the shared ones", async () => {
    await households.leaveHousehold(await caller("max"));
    expect((await oneAs("max").GET(request("GET"), ctx(privateId))).status).toBe(200);
    expect((await oneAs("max").GET(request("GET"), ctx(sharedId))).status).toBe(404);
    expect((await oneAs("erika").GET(request("GET"), ctx(sharedId))).status).toBe(200);
  });

  it("deletes shared accounts when the last member leaves", async () => {
    await households.leaveHousehold(await caller("dora"));
    const dorasPrivate = await create("dora", { ...giro, name: "Doras Giro" });
    expect(((await (await listAs("dora").GET()).json()).accounts as { id: string }[]).map((a) => a.id)).toEqual([
      dorasPrivate.id,
    ]);
  });
});
