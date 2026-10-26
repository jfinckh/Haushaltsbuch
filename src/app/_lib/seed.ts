import "server-only";
import type { Accounts } from "@/accounts/server";
import type { Auth } from "@/auth/server";
import type { Households } from "@/households/server";
import type { Imports } from "@/import/server";
import type { Rules } from "@/rules/server";
import type { Caller } from "@/shared/rls";
import type { Transactions } from "@/transactions/server";
import type { Transfers } from "@/transfers/server";
import { createImportWorkflow } from "./import-workflow";

// Seed data for local development (docs/konzept.md, "Lokal starten"): two users, their household,
// the accounts from the concept and the four test files, imported like an upload in the browser.
// Run with `npm run db:seed`. It only inserts, and refuses when a seed user already exists.

export const SEED_USERS = {
  max: { name: "Max Mustermann", email: "max@example.test" },
  erika: { name: "Erika Mustermann", email: "erika@example.test" },
} as const;

/** The IBAN of the ING test file (test-data/ing_testdaten.csv), fictional. */
const ING_GIRO_IBAN = "DE94 1234 5678 1111 1111 11";

/** The IBAN of Erika's ING test file (test-data/ing_erika_testdaten.csv), fictional. */
const ERIKA_ING_IBAN = "DE50 1234 5678 4444 4444 44";

/** The ING test file's last saldo: after the import the Giro balance must be 703,26 €. */
const ING_EXPECTED_BALANCE_CENTS = 70326;

type SeedAuth = {
  userExists: (email: string) => Promise<boolean>;
  /** Creates the user and a session for it (no password: locally you sign in with the dev sign-in). */
  createUser: (input: { name: string; email: string }) => Promise<{ userId: string; caller: Caller }>;
};

export type SeedDeps = {
  auth: SeedAuth;
  households: Households;
  accounts: Accounts;
  transactions: Transactions;
  imports: Imports;
  rules: Rules;
  transfers: Transfers;
  householdMembers: (caller: Caller) => Promise<{ userId: string; name: string }[]>;
  /** The test files' bytes. */
  files: { ing: Uint8Array; tradeRepublic: Uint8Array; shared: Uint8Array; erika: Uint8Array };
};

type ImportSummary = { newCount: number; linked: number };

export type SeedResult =
  | { ok: true; imports: Record<keyof SeedDeps["files"], ImportSummary> }
  | { ok: false; reason: "already-seeded" };

/** The seed's view of auth: the check for existing users and creating one with a session. */
export function seedAuthFrom(auth: Auth): SeedAuth {
  return {
    userExists: (email) => auth.userExists(email),
    async createUser(input) {
      const { userId, sessionToken } = await auth.ensureUserSession(input);
      return { userId, caller: { sessionToken } };
    },
  };
}

async function createAccount(accounts: Accounts, caller: Caller, input: Record<string, unknown>) {
  const result = await accounts.createAccount(caller, input);
  if (!result.ok) throw new Error(`Creating a seed account failed: ${result.reason}`);
  return result.accounts;
}

/** Imports a file as an upload does: import with opening balance, rules, matching. */
async function upload(deps: SeedDeps, caller: Caller, accountId: string, name: string, bytes: Uint8Array) {
  // Same workflow as src/app/api/imports/route.ts.
  const workflow = createImportWorkflow(deps);
  const result = await workflow.confirm(caller, { accountId, fileName: name, bytes });
  // Only the error code: never booking data.
  if (!result.ok) throw new Error(`Importing ${name} failed: ${result.reason}`);
  return { newCount: result.import.newCount, linked: result.transfers?.linked ?? 0 };
}

/** Creates the seed users, household and accounts and imports the test files. */
export async function seedDevData(deps: SeedDeps): Promise<SeedResult> {
  const { auth, households, accounts, transactions } = deps;
  for (const user of Object.values(SEED_USERS)) {
    if (await auth.userExists(user.email)) return { ok: false, reason: "already-seeded" };
  }

  const max = await auth.createUser(SEED_USERS.max);
  const erika = await auth.createUser(SEED_USERS.erika);
  const created = await households.createHousehold(max.caller, { name: "Mustermann" });
  if (!created.ok) throw new Error(`Creating the seed household failed: ${created.reason}`);
  // As if Erika accepted Max's invite link right now.
  await households.joinInvitersHousehold(erika.caller, { inviterId: max.userId, invitedAt: new Date() });

  const zero = { openingBalance: "0" };
  const [giro] = await createAccount(accounts, max.caller, {
    name: "ING Giro", bank: "ing", type: "checking", visibility: "private", iban: ING_GIRO_IBAN, ...zero,
  });
  const [clearing] = await createAccount(accounts, max.caller, {
    setup: "trade-republic", visibility: "private", clearingOpeningBalance: "0", depotOpeningBalance: "0",
  });
  const [shared] = await createAccount(accounts, max.caller, {
    name: "ING Gemeinschaftskonto", bank: "ing", type: "checking", visibility: "shared", ...zero,
  });
  await createAccount(accounts, erika.caller, {
    name: "Erika Girokonto", bank: "other", type: "checking", visibility: "private", ...zero,
  });
  const [erikaGiro] = await createAccount(accounts, erika.caller, {
    name: "Erika ING Giro", bank: "ing", type: "checking", visibility: "private", iban: ERIKA_ING_IBAN, ...zero,
  });

  const ing = await upload(deps, max.caller, giro.id, "ing_testdaten.csv", deps.files.ing);
  const tradeRepublic = await upload(deps, max.caller, clearing.id, "traderepublic_testdaten.csv", deps.files.tradeRepublic);
  // After the ING Giro, so Max's "Miete und co" links; Erika's file last, so her transfers link too.
  const sharedImport = await upload(deps, max.caller, shared.id, "ing_gemeinschaftskonto_testdaten.csv", deps.files.shared);
  const erikaImport = await upload(deps, erika.caller, erikaGiro.id, "ing_erika_testdaten.csv", deps.files.erika);

  const account = await accounts.getAccount(max.caller, giro.id);
  const balance = (account?.openingBalanceCents ?? 0) + ((await transactions.balances(max.caller))[giro.id] ?? 0);
  // Says only that it differs, never the amount.
  if (balance !== ING_EXPECTED_BALANCE_CENTS) throw new Error("The ING Giro balance after the import is not the file's saldo");

  return { ok: true, imports: { ing, tradeRepublic, shared: sharedImport, erika: erikaImport } };
}
