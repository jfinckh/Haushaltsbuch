import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { currentBalances } from "@/app/_lib/balances";
import { importPreviewRoute, importRoute, importsRoute, MAX_UPLOAD_BYTES } from "@/app/_lib/imports-route";
import { createAccounts, type Accounts } from "@/accounts/server";
import { createHouseholds } from "@/households/server";
import { createImports, type Imports } from "@/import/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import type { Caller, RlsDatabase } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createTransactions, type Transactions } from "@/transactions/server";

// Privacy tests for every import route: a member never previews, imports into, sees or undoes
// imports of another member's private account, and another household sees nothing at all. Plus the
// acceptance test from CLAUDE.md: after importing the ING test file the balance is 703,26 €.

const ING = readFileSync(new URL("../../../../test-data/ing_testdaten.csv", import.meta.url));
const TR = readFileSync(new URL("../../../../test-data/traderepublic_testdaten.csv", import.meta.url));

let db: RlsDatabase;
let accounts: Accounts;
let transactions: Transactions;
let imports: Imports;
let callers: Map<string, Promise<Caller>>;

function sessionOf(userId: string | null) {
  return async () => {
    if (userId === null) return null;
    if (!callers.has(userId)) callers.set(userId, createTestSession(db, userId));
    return callers.get(userId)!;
  };
}

const caller = async (userId: string) => (await sessionOf(userId)())!;
const deps = (userId: string | null) => ({ imports, accounts, transactions, getCaller: sessionOf(userId) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function upload(accountId: string, bytes: Buffer = ING, name = "Umsatzanzeige.csv") {
  const body = new FormData();
  body.set("accountId", accountId);
  body.set("file", new File([new Uint8Array(bytes)], name, { type: "text/csv" }));
  return new Request("http://localhost/api/imports", { method: "POST", body });
}

const previewAs = (userId: string | null, accountId: string, bytes?: Buffer) =>
  importPreviewRoute(deps(userId)).POST(upload(accountId, bytes));
const importAs = (userId: string | null, accountId: string, bytes?: Buffer) => importsRoute(deps(userId)).POST(upload(accountId, bytes));
const listAs = (userId: string | null, query = "") =>
  importsRoute(deps(userId)).GET(new Request(`http://localhost/api/imports${query}`));
const undoAs = (userId: string | null, id: string) =>
  importRoute(deps(userId)).DELETE(new Request("http://localhost/api/imports/x", { method: "DELETE" }), ctx(id));

async function createAccount(userId: string, visibility: "private" | "shared", name: string, bank = "ing", type = "checking") {
  const result = await accounts.createAccount(await caller(userId), { name, bank, type, visibility, openingBalance: "0" });
  if (!result.ok) throw new Error(result.reason);
  return result.accounts[0].id;
}

async function balanceOf(userId: string, accountId: string) {
  const account = (await accounts.getAccount(await caller(userId), accountId))!;
  return currentBalances([account], await transactions.balances(await caller(userId)))[accountId];
}

async function imported(userId: string, accountId: string, bytes?: Buffer): Promise<{ id: string }> {
  const response = await importAs(userId, accountId, bytes);
  expect(response.status).toBe(201);
  return (await response.json()).import;
}

let maxPrivate: string;
let shared: string;
let maxTr: string;
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
  const households = createHouseholds({ db, householdHoldsData: accounts.householdHasSharedAccounts });
  await households.createHousehold(await caller("max"), { name: "Mustermann" });
  await households.joinInvitersHousehold(await caller("erika"), { inviterId: "max", invitedAt: new Date() });
  await households.createHousehold(await caller("dora"), { name: "Other" });

  maxPrivate = await createAccount("max", "private", "ING Giro");
  shared = await createAccount("max", "shared", "Gemeinschaftskonto");
  maxTr = await createAccount("max", "private", "TR Verrechnungskonto", "trade_republic", "clearing");
  doras = await createAccount("dora", "shared", "Doras");
});

describe("acceptance: ING test file", () => {
  it("previews the opening balance it will set", async () => {
    const response = await previewAs("max", maxPrivate);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preview.counts).toEqual({ rows: 29, new: 29, duplicate: 0, skipped: 0 });
    expect(body.openingBalance).toEqual({ willSet: true, cents: 180000 });
  });

  it("ends with a balance of 703,26 € in an account that started at 0", async () => {
    expect(await balanceOf("max", maxPrivate)).toBe(0);
    const response = await importAs("max", maxPrivate);
    expect(response.status).toBe(201);
    expect((await response.json()).openingBalanceCents).toBe(180000);
    expect(await balanceOf("max", maxPrivate)).toBe(70326);
  });

  it("imports the same file twice without a change", async () => {
    await imported("max", maxPrivate);
    const preview = await (await previewAs("max", maxPrivate)).json();
    expect(preview.preview.counts).toMatchObject({ new: 0, duplicate: 29 });
    expect(preview.openingBalance).toEqual({ willSet: false, cents: null });
    const second = await imported("max", maxPrivate);
    expect(second).toMatchObject({ newCount: 0 });
    expect(await balanceOf("max", maxPrivate)).toBe(70326);
  });

  it("leaves the opening balance alone when the account already has bookings", async () => {
    await transactions.createTransaction(await caller("max"), {
      accountId: maxPrivate,
      date: "2026-08-01",
      amount: "10,00",
      kind: "income",
    });
    expect((await (await previewAs("max", maxPrivate)).json()).openingBalance.willSet).toBe(false);
    await imported("max", maxPrivate);
    expect((await accounts.getAccount(await caller("max"), maxPrivate))!.openingBalanceCents).toBe(0);
  });
});

describe("after a confirmed import", () => {
  it("starts the transfer matching with the ids of the new bookings and returns its counts", async () => {
    const calls: string[][] = [];
    const body = new FormData();
    body.set("accountId", maxPrivate);
    body.set("file", new File([new Uint8Array(ING)], "Umsatzanzeige.csv", { type: "text/csv" }));
    const route = importsRoute({
      ...deps("max"),
      afterImport: async (_caller, bookingIds) => {
        calls.push(bookingIds);
        return { linked: 2, proposed: 1 };
      },
    });
    const response = await route.POST(new Request("http://localhost/api/imports", { method: "POST", body }));
    expect(response.status).toBe(201);
    expect((await response.json()).transfers).toEqual({ linked: 2, proposed: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(29);
  });

  it("applies the rules first and hands their transfers to the matching", async () => {
    const order: string[] = [];
    const body = new FormData();
    body.set("accountId", maxPrivate);
    body.set("file", new File([new Uint8Array(ING)], "Umsatzanzeige.csv", { type: "text/csv" }));
    const route = importsRoute({
      ...deps("max"),
      applyRules: async (_caller, bookingIds) => {
        order.push("rules");
        return { applied: 2, transfers: [{ id: bookingIds[0], target: "external" as const }] };
      },
      afterImport: async (_caller, bookingIds, ruleTransfers) => {
        order.push("matching");
        expect(ruleTransfers).toEqual([{ id: bookingIds[0], target: "external" }]);
        return { linked: 0, proposed: 0 };
      },
    });
    const response = await route.POST(new Request("http://localhost/api/imports", { method: "POST", body }));
    expect(response.status).toBe(201);
    expect((await response.json()).rules).toEqual({ applied: 2 });
    expect(order).toEqual(["rules", "matching"]);
  });

  it("keeps the import and still matches when the rules fail", async () => {
    let matched = false;
    const body = new FormData();
    body.set("accountId", maxPrivate);
    body.set("file", new File([new Uint8Array(ING)], "Umsatzanzeige.csv", { type: "text/csv" }));
    const route = importsRoute({
      ...deps("max"),
      applyRules: async () => {
        throw new Error("boom");
      },
      afterImport: async (_caller, _ids, ruleTransfers) => {
        matched = ruleTransfers.length === 0;
        return { linked: 0, proposed: 0 };
      },
    });
    const response = await route.POST(new Request("http://localhost/api/imports", { method: "POST", body }));
    expect(response.status).toBe(201);
    expect((await response.json()).rules).toBeNull();
    expect(matched).toBe(true);
    expect(await balanceOf("max", maxPrivate)).toBe(70326);
  });

  it("keeps the import when the matching fails", async () => {
    const body = new FormData();
    body.set("accountId", maxPrivate);
    body.set("file", new File([new Uint8Array(ING)], "Umsatzanzeige.csv", { type: "text/csv" }));
    const route = importsRoute({
      ...deps("max"),
      afterImport: async () => {
        throw new Error("boom");
      },
    });
    const response = await route.POST(new Request("http://localhost/api/imports", { method: "POST", body }));
    expect(response.status).toBe(201);
    expect((await response.json()).transfers).toBeNull();
    expect(await balanceOf("max", maxPrivate)).toBe(70326);
  });
});

describe("/api/imports", () => {
  it("needs a session", async () => {
    expect((await previewAs(null, maxPrivate)).status).toBe(401);
    expect((await importAs(null, maxPrivate)).status).toBe(401);
    expect((await listAs(null)).status).toBe(401);
    expect((await undoAs(null, "x")).status).toBe(401);
  });

  it("rejects missing fields and unknown files", async () => {
    const empty = new Request("http://localhost/api/imports", { method: "POST", body: new FormData() });
    expect((await importsRoute(deps("max")).POST(empty)).status).toBe(400);
    const response = await previewAs("max", maxPrivate, Buffer.from("a;b\n1;2"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unknown-format" });
  });

  it("refuses a body over the limit before reading it, with or without a size header", async () => {
    let pulled = 0;
    /** A body that would never end; counts how much of it the route reads. */
    const endless = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 64 * 1024;
          controller.enqueue(new Uint8Array(64 * 1024));
        },
      });
    const post = (headers: Record<string, string>) =>
      importsRoute(deps("max")).POST(
        new Request("http://localhost/api/imports", {
          method: "POST",
          body: endless(),
          headers: { "content-type": "multipart/form-data; boundary=x", ...headers },
          duplex: "half",
        } as RequestInit),
      );

    const declared = await post({ "content-length": String(MAX_UPLOAD_BYTES + 1) });
    expect(declared.status).toBe(400);
    expect(await declared.json()).toEqual({ error: "too-large" });
    expect(pulled).toBeLessThanOrEqual(64 * 1024 * 2);

    for (const headers of [{}, { "content-length": "100" }] as Record<string, string>[]) {
      pulled = 0;
      const response = await post(headers);
      expect(await response.json()).toEqual({ error: "too-large" });
      expect(pulled).toBeLessThan(MAX_UPLOAD_BYTES + 3 * 64 * 1024);
    }
  });

  it("refuses a file over the import's own limit", async () => {
    const big = Buffer.concat([ING, Buffer.alloc(1024 * 1024)]);
    const response = await importAs("max", maxPrivate, big);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "too-large" });
  });

  it("rejects a file that does not fit the account's bank", async () => {
    const response = await importAs("max", maxTr, ING);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "wrong-bank" });
    expect((await importAs("max", maxTr, TR)).status).toBe(201);
    expect((await previewAs("max", maxPrivate, TR)).status).toBe(400);
  });

  it("lists imports and undoes them", async () => {
    const done = await imported("max", maxPrivate);
    const list = await (await listAs("max", `?accountId=${maxPrivate}`)).json();
    expect(list.imports.map((i: { id: string }) => i.id)).toEqual([done.id]);
    expect(JSON.stringify(list)).not.toContain("Encrypted");
    expect(JSON.stringify(list)).not.toContain("createdByUserId");
    expect((await undoAs("max", done.id)).status).toBe(200);
    expect((await (await listAs("max")).json()).imports).toEqual([]);
    expect((await undoAs("max", done.id)).status).toBe(404);
  });
});

describe("another member's private account", () => {
  it("cannot be previewed or imported into, and looks like an unknown account", async () => {
    const preview = await previewAs("erika", maxPrivate);
    const unknown = await previewAs("erika", "nope");
    expect(preview.status).toBe(404);
    expect(await preview.json()).toEqual(await unknown.json());
    expect((await importAs("erika", maxPrivate)).status).toBe(404);
    expect((await importAs("dora", shared)).status).toBe(404);
    expect(await transactions.balances(await caller("max"))).toEqual({});
  });

  it("hides its imports and cannot undo them", async () => {
    const own = await imported("max", maxPrivate);
    expect((await (await listAs("erika")).json()).imports).toEqual([]);
    expect((await (await listAs("erika", `?accountId=${maxPrivate}`)).json()).imports).toEqual([]);
    const undo = await undoAs("erika", own.id);
    const unknown = await undoAs("erika", "nope");
    expect(undo.status).toBe(404);
    expect(await undo.json()).toEqual(await unknown.json());
    expect((await undoAs("dora", own.id)).status).toBe(404);
    expect(await balanceOf("max", maxPrivate)).toBe(70326);
  });
});

describe("a shared account", () => {
  it("shares its imports with the household, and only with it", async () => {
    const done = await imported("max", shared);
    const erikasList = (await (await listAs("erika")).json()).imports;
    expect(erikasList).toMatchObject([{ id: done.id, createdByMe: false }]);
    expect((await (await listAs("dora")).json()).imports).toEqual([]);
    expect((await undoAs("dora", done.id)).status).toBe(404);
    expect((await undoAs("erika", done.id)).status).toBe(200);
  });

  it("lets every member import into it", async () => {
    expect((await importAs("erika", shared)).status).toBe(201);
    expect((await importAs("dora", doras, TR)).status).toBe(400);
  });
});
