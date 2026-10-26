import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { withSession, type Caller, type RlsDatabase } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { accountIsVisible, accountScopes, notOnSavingsAccount, ownPrivateAccount, visibleAccount } from "./accounts";
import { currentHouseholdId, inCurrentHousehold } from "./households";

// The typed calls against the real migrations. Max and Erika share household "h1"; each has a
// private account. "stranger" has household "h2" with a shared account none of them may see.

/** Just the columns the conditions need (the table belongs to accounts). */
const account = pgTable("account", { id: text("id").notNull(), householdId: text("household_id") });

let db: RlsDatabase;
const callers: Record<string, Caller> = {};

async function addHousehold(id: string, ...userIds: string[]) {
  await db.execute(sql`INSERT INTO household (id, name, created_by_user_id) VALUES (${id}, ${id}, ${userIds[0]})`);
  for (const userId of userIds) await db.execute(sql`INSERT INTO household_member (household_id, user_id) VALUES (${id}, ${userId})`);
}

async function addAccount(id: string, ownerUserId: string, householdId: string | null, role: "everyday" | "savings" = "everyday") {
  await db.execute(sql`
    INSERT INTO account (id, owner_user_id, household_id, visibility, name, bank, type, role, opening_balance_cents)
    VALUES (${id}, ${ownerUserId}, ${householdId}, ${householdId ? "shared" : "private"}, ${id}, 'ing', 'checking', ${role}, 0)`);
}

const as = <T>(userId: string, fn: Parameters<typeof withSession<T>>[2]) => withSession(db, callers[userId], fn);

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite() });
  await migrate(pglite, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  db = pglite;
  for (const userId of ["max", "erika", "stranger", "loner"]) callers[userId] = await createTestSession(db, userId);
  await addHousehold("h1", "max", "erika");
  await addHousehold("h2", "stranger");
  await addAccount("max-private", "max", null);
  await addAccount("max-savings", "max", null, "savings");
  await addAccount("erika-private", "erika", null);
  await addAccount("h1-shared", "max", "h1");
  await addAccount("h2-shared", "stranger", "h2");
});

describe("accounts' contract", () => {
  it("shows a member their own private and the household's shared accounts, never another member's private one", async () => {
    const ids = await as("max", (tx) => tx.select({ id: account.id }).from(account).where(visibleAccount(account.id)));
    expect(ids.map((row) => row.id).sort()).toEqual(["h1-shared", "max-private", "max-savings"]);
    expect(await as("max", (tx) => accountIsVisible(tx, "h1-shared"))).toBe(true);
    expect(await as("max", (tx) => accountIsVisible(tx, "erika-private"))).toBe(false);
    expect(await as("max", (tx) => accountIsVisible(tx, "h2-shared"))).toBe(false);
  });

  it("tells own private accounts and savings accounts apart", async () => {
    const own = await as("max", (tx) => tx.select({ id: account.id }).from(account).where(ownPrivateAccount(account.id)));
    expect(own.map((row) => row.id).sort()).toEqual(["max-private", "max-savings"]);
    const notSavings = await as("max", (tx) =>
      tx.select({ id: account.id }).from(account).where(sql`${visibleAccount(account.id)} AND ${notOnSavingsAccount(account.id)}`),
    );
    expect(notSavings.map((row) => row.id).sort()).toEqual(["h1-shared", "max-private"]);
  });

  it("lists visible scopes, all or only the given ones", async () => {
    const all = await as("erika", (tx) => accountScopes(tx));
    expect(all.sort((a, b) => a.accountId.localeCompare(b.accountId))).toEqual([
      { accountId: "erika-private", householdId: null },
      { accountId: "h1-shared", householdId: "h1" },
    ]);
    expect(await as("erika", (tx) => accountScopes(tx, ["max-private", "h1-shared"]))).toEqual([{ accountId: "h1-shared", householdId: "h1" }]);
    expect(await as("erika", (tx) => accountScopes(tx, []))).toEqual([]);
  });
});

describe("households' contract", () => {
  it("finds the session user's household, or null without one", async () => {
    expect(await as("erika", (tx) => currentHouseholdId(tx))).toBe("h1");
    expect(await as("loner", (tx) => currentHouseholdId(tx))).toBeNull();
    const inMine = await as("stranger", (tx) => tx.select({ id: account.id }).from(account).where(inCurrentHousehold(account.householdId)));
    expect(inMine.map((row) => row.id)).toEqual(["h2-shared"]);
  });
});
