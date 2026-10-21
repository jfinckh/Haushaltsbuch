import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createFieldCrypto } from "@/shared/field-crypto";
import type { Caller } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";

/**
 * A fresh in-memory Postgres with the real migrations for transactions tests. Households and
 * accounts are written straight into their tables (tests only, so transactions stays independent
 * of their code; the table names are part of their database contract).
 */
export async function createTestDatabase() {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  const crypto = createFieldCrypto({
    keys: `1:${randomBytes(32).toString("base64")}`,
    indexKey: randomBytes(32).toString("base64"),
  });

  const callers = new Map<string, Promise<Caller>>();
  /** Signs the user in (once) and returns their session. */
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

  /** A private account of `ownerUserId`, or a shared one of `householdId`. */
  async function addAccount(id: string, ownerUserId: string, householdId: string | null = null, openingBalanceCents = 0) {
    await db.execute(sql`
      INSERT INTO account (id, owner_user_id, household_id, visibility, name, bank, type, role, opening_balance_cents)
      VALUES (${id}, ${ownerUserId}, ${householdId}, ${householdId ? "shared" : "private"}, ${id}, 'ing', 'checking',
        'everyday', ${openingBalanceCents})`);
  }

  async function makePrivate(accountId: string) {
    await db.execute(sql`UPDATE account SET visibility = 'private', household_id = NULL WHERE id = ${accountId}`);
  }

  async function deleteAccount(accountId: string) {
    await db.execute(sql`DELETE FROM account WHERE id = ${accountId}`);
  }

  return { db, crypto, as, householdOf, addAccount, makePrivate, deleteAccount };
}
