import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccounts, type Accounts } from "@/accounts/server";
import { createAuth, type Auth } from "@/auth/server";
import { createHouseholds } from "@/households/server";
import { createImports } from "@/import/server";
import { createRules } from "@/rules/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import type { Caller } from "@/shared/rls";
import { createTransactions, type Transactions } from "@/transactions/server";
import { createTransfers } from "@/transfers/server";
import { householdMembersOf } from "./members";
import { SEED_USERS, seedAuthFrom, seedDevData, type SeedDeps } from "./seed";

// The dev seed on a fresh in-memory Postgres with the real services: what it creates, the ING
// balance from CLAUDE.md, privacy between Max and Erika, and that it never runs twice.

const files = {
  ing: new Uint8Array(readFileSync(new URL("../../../test-data/ing_testdaten.csv", import.meta.url))),
  tradeRepublic: new Uint8Array(readFileSync(new URL("../../../test-data/traderepublic_testdaten.csv", import.meta.url))),
  shared: new Uint8Array(readFileSync(new URL("../../../test-data/ing_gemeinschaftskonto_testdaten.csv", import.meta.url))),
  erika: new Uint8Array(readFileSync(new URL("../../../test-data/ing_erika_testdaten.csv", import.meta.url))),
};

let auth: Auth;
let accounts: Accounts;
let transactions: Transactions;
let deps: SeedDeps;

beforeEach(async () => {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../../drizzle", import.meta.url).pathname });
  const crypto = createFieldCrypto({
    keys: `1:${randomBytes(32).toString("base64")}`,
    indexKey: randomBytes(32).toString("base64"),
  });
  auth = createAuth({
    db,
    secret: "test-secret-test-secret-test-secret-123",
    baseURL: "http://localhost:3000",
    mode: { kind: "dev" },
  });
  accounts = createAccounts({ db, crypto });
  transactions = createTransactions({ db, crypto });
  const households = createHouseholds({ db, householdHoldsData: accounts.householdHasSharedAccounts });
  deps = {
    auth: seedAuthFrom(auth),
    households,
    accounts,
    transactions,
    imports: createImports({ db, crypto, transactions }),
    rules: createRules({ db, crypto, transactions }),
    transfers: createTransfers({ db, crypto, transactions }),
    householdMembers: householdMembersOf({
      listMembers: (caller) => households.listMembers(caller),
      getUserNames: (ids) => auth.getUserNames(ids),
    }),
    files,
  };
});

/** Signs in as the dev sign-in page does. */
async function signIn(email: string): Promise<Caller> {
  const result = await auth.api.devSignIn({ body: { email } });
  return { sessionToken: result.token };
}

async function balanceOf(caller: Caller, accountId: string) {
  const account = (await accounts.getAccount(caller, accountId))!;
  return account.openingBalanceCents + ((await transactions.balances(caller))[accountId] ?? 0);
}

const names = async (caller: Caller) => (await accounts.listAccounts(caller)).map((a) => a.name).sort();

describe("seedDevData", () => {
  it("creates both users, who can sign in with the dev sign-in", async () => {
    const result = await seedDevData(deps);
    expect(result.ok).toBe(true);
    for (const user of Object.values(SEED_USERS)) {
      expect(await auth.userExists(user.email)).toBe(true);
      await expect(signIn(user.email)).resolves.toMatchObject({ sessionToken: expect.any(String) });
    }
  });

  it("puts both into one household and creates the accounts from the concept", async () => {
    await seedDevData(deps);
    const max = await signIn(SEED_USERS.max.email);
    const erika = await signIn(SEED_USERS.erika.email);
    expect(await deps.households.listMembers(max)).toHaveLength(2);
    expect(await names(max)).toEqual(["ING Gemeinschaftskonto", "ING Giro", "Trade Republic", "Trade Republic Depot"]);
    // Privacy: Erika sees the shared account and her own, none of Max's private ones.
    expect(await names(erika)).toEqual(["Erika Girokonto", "Erika ING Giro", "ING Gemeinschaftskonto"]);
  });

  it("imports both files like an upload: ING balance 703,26 €, ING ↔ TR transfers linked", async () => {
    const result = await seedDevData(deps);
    if (!result.ok) throw new Error(result.reason);
    expect(result.imports.ing.newCount).toBe(29);
    expect(result.imports.tradeRepublic.newCount).toBeGreaterThan(0);
    expect(result.imports.tradeRepublic.linked).toBe(2);

    const max = await signIn(SEED_USERS.max.email);
    const giro = (await accounts.listAccounts(max)).find((a) => a.name === "ING Giro")!;
    expect(await balanceOf(max, giro.id)).toBe(70326);
  });

  it("imports the shared and Erika's ING file with the files' saldos and links their transfers", async () => {
    const result = await seedDevData(deps);
    if (!result.ok) throw new Error(result.reason);
    expect(result.imports.shared.newCount).toBe(126);
    expect(result.imports.shared.linked).toBeGreaterThan(0);
    expect(result.imports.erika.newCount).toBe(47);
    expect(result.imports.erika.linked).toBeGreaterThan(0);

    const max = await signIn(SEED_USERS.max.email);
    const erika = await signIn(SEED_USERS.erika.email);
    const shared = (await accounts.listAccounts(max)).find((a) => a.name === "ING Gemeinschaftskonto")!;
    const erikaGiro = (await accounts.listAccounts(erika)).find((a) => a.name === "Erika ING Giro")!;
    expect(await balanceOf(max, shared.id)).toBe(200813);
    expect(await balanceOf(erika, erikaGiro.id)).toBe(425221);
    // Privacy: Max never sees Erika's private account or its bookings.
    expect(await accounts.getAccount(max, erikaGiro.id)).toBeFalsy();
    expect((await transactions.balances(max))[erikaGiro.id]).toBeUndefined();
  });

  it("refuses a second run and changes nothing", async () => {
    await seedDevData(deps);
    const max = await signIn(SEED_USERS.max.email);
    const before = await accounts.listAccounts(max);
    const balancesBefore = await transactions.balances(max);

    expect(await seedDevData(deps)).toEqual({ ok: false, reason: "already-seeded" });
    expect(await accounts.listAccounts(max)).toHaveLength(before.length);
    expect(await transactions.balances(max)).toEqual(balancesBefore);
  });

  it("refuses when only one of the seed users exists, without creating the other", async () => {
    await auth.api.devSignIn({ body: { name: "Someone", email: SEED_USERS.erika.email } });
    expect(await seedDevData(deps)).toEqual({ ok: false, reason: "already-seeded" });
    expect(await auth.userExists(SEED_USERS.max.email)).toBe(false);
  });
});
