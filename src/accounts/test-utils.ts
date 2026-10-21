import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createFieldCrypto } from "@/shared/field-crypto";
import type { Caller } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createAccounts } from "./create-accounts";

/** Random keys for tests. */
export function testCrypto() {
  return createFieldCrypto({
    keys: `1:${randomBytes(32).toString("base64")}`,
    indexKey: randomBytes(32).toString("base64"),
  });
}

/**
 * The accounts part on a fresh in-memory Postgres with the real migrations. `as(userId)` signs the
 * user in; `householdOf(id, ...userIds)` puts users into a household directly in households'
 * tables (tests only, so accounts stays independent of households' code).
 */
export async function createTestAccounts() {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  const crypto = testCrypto();
  const callers = new Map<string, Promise<Caller>>();
  function as(userId: string): Promise<Caller> {
    if (!callers.has(userId)) callers.set(userId, createTestSession(db, userId));
    return callers.get(userId)!;
  }
  async function householdOf(householdId: string, ...userIds: string[]) {
    await db.execute(sql`
      INSERT INTO household (id, name, created_by_user_id) VALUES (${householdId}, ${householdId}, ${userIds[0]})
      ON CONFLICT (id) DO NOTHING`);
    for (const userId of userIds) {
      await db.execute(sql`INSERT INTO household_member (household_id, user_id) VALUES (${householdId}, ${userId})`);
    }
  }
  async function leaveHousehold(userId: string) {
    await db.execute(sql`DELETE FROM household_member WHERE user_id = ${userId}`);
  }
  async function deleteHousehold(householdId: string) {
    await db.execute(sql`DELETE FROM household WHERE id = ${householdId}`);
  }
  return { accounts: createAccounts({ db, crypto }), db, crypto, as, householdOf, leaveHousehold, deleteHousehold };
}

export const IBAN = "DE89370400440532013000";
