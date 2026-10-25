import "server-only";
import type { Accounts } from "@/accounts/server";
import type { Auth } from "@/auth/server";
import type { createHouseholds } from "@/households/server";
import type { Imports } from "@/import/server";
import type { Rules } from "@/rules/server";
import type { Caller } from "@/shared/rls";
import type { Transactions } from "@/transactions/server";
import type { Transfers } from "@/transfers/server";
import { importsRoute } from "./imports-route";

// Seed data for local development (docs/konzept.md, "Lokal starten"): two users, their household,
// the accounts from the concept and the four test files, imported like an upload in the browser.
// Run with `npm run db:seed`. It only inserts, and refuses when a seed user already exists.

/** The test password of both seed users. Documented in the README; never printed. */
export const SEED_PASSWORD = "haushalt-test-1234";

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
  /** Signs the user up like the form does and returns the new user's id and session. */
  signUp: (input: { name: string; email: string; password: string }) => Promise<{ userId: string; caller: Caller }>;
};

export type SeedDeps = {
  auth: SeedAuth;
  households: ReturnType<typeof createHouseholds>;
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

/** The seed's view of auth: the check for existing users and sign-up with a session. */
export function seedAuthFrom(auth: Auth): SeedAuth {
  return {
    userExists: (email) => auth.userExists(email),
    async signUp(input) {
      const result = await auth.api.signUpEmail({ body: input });
      if (!result.token) throw new Error("Sign-up returned no session");
      return { userId: result.user.id, caller: { sessionToken: result.token } };
    },
  };
}

async function createAccount(accounts: Accounts, caller: Caller, input: Record<string, unknown>) {
  const result = await accounts.createAccount(caller, input);
  if (!result.ok) throw new Error(`Creating a seed account failed: ${result.reason}`);
  return result.accounts;
}

/** Uploads a file through the app's import handler: import, opening balance, rules, matching. */
async function upload(deps: SeedDeps, caller: Caller, accountId: string, name: string, bytes: Uint8Array) {
  const { imports, accounts, transactions, rules, transfers, householdMembers } = deps;
  // Same wiring as src/app/api/imports/route.ts.
  const route = importsRoute({
    imports,
    accounts,
    transactions,
    getCaller: async () => caller,
    applyRules: (c, bookingIds) => rules.applyToBookings(c, bookingIds),
    afterImport: async (c, bookingIds, ruleTransfers) =>
      transfers.matchAfterImport(c, { bookingIds, members: await householdMembers(c), ruleTransfers }),
  });
  const body = new FormData();
  body.set("accountId", accountId);
  body.set("file", new File([new Uint8Array(bytes)], name, { type: "text/csv" }));
  const response = await route.POST(new Request("http://localhost/api/imports", { method: "POST", body }));
  const json = await response.json();
  // Only the status and the error code: never booking data.
  if (response.status !== 201) throw new Error(`Importing ${name} failed: ${response.status} ${json.error ?? ""}`);
  return { newCount: json.import.newCount as number, linked: (json.transfers?.linked ?? 0) as number };
}

/** Creates the seed users, household and accounts and imports the test files. */
export async function seedDevData(deps: SeedDeps): Promise<SeedResult> {
  const { auth, households, accounts, transactions } = deps;
  for (const user of Object.values(SEED_USERS)) {
    if (await auth.userExists(user.email)) return { ok: false, reason: "already-seeded" };
  }

  const max = await auth.signUp({ ...SEED_USERS.max, password: SEED_PASSWORD });
  const erika = await auth.signUp({ ...SEED_USERS.erika, password: SEED_PASSWORD });
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
