import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createFieldCrypto } from "@/shared/field-crypto";
import { rows, type Caller, type RlsTransaction } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createTransactions } from "@/transactions/server";

/**
 * A fresh in-memory Postgres with the real migrations for import tests. Households and accounts are
 * written straight into their tables (tests only, so import stays independent of their code; the
 * table names are part of their database contract).
 */
export async function createTestDatabase() {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  const crypto = createFieldCrypto({
    keys: `1:${randomBytes(32).toString("base64")}`,
    indexKey: randomBytes(32).toString("base64"),
  });
  const transactions = createTransactions({ db, crypto });

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

  /** A private ING account of `ownerUserId`, or a shared one of `householdId`. */
  async function addAccount(id: string, ownerUserId: string, householdId: string | null = null) {
    await db.execute(sql`
      INSERT INTO account (id, owner_user_id, household_id, visibility, name, bank, type, role)
      VALUES (${id}, ${ownerUserId}, ${householdId}, ${householdId ? "shared" : "private"}, ${id}, 'ing', 'checking',
        'everyday')`);
  }

  async function makePrivate(accountId: string) {
    await db.execute(sql`UPDATE account SET visibility = 'private', household_id = NULL WHERE id = ${accountId}`);
  }

  async function deleteAccount(accountId: string) {
    await db.execute(sql`DELETE FROM account WHERE id = ${accountId}`);
  }

  /** Bookings of an account, straight from the table (past row-level security). */
  async function bookingsOf(accountId: string) {
    const result = (await db.execute(
      sql`SELECT id, booking_date, amount_cents FROM "transaction" WHERE account_id = ${accountId} ORDER BY booking_date`,
    )) as unknown as { rows: { id: string; booking_date: string; amount_cents: string }[] };
    return result.rows;
  }

  /**
   * Sets an opening balance as accounts does (straight into its table, under row-level security, so
   * only visible accounts change). Stands in for accounts' setOpeningBalance in import tests.
   */
  async function setOpeningBalance(tx: RlsTransaction, _userId: string, accountId: string, cents: number) {
    const [row] = await rows<{ cents: number }>(
      tx,
      sql`UPDATE account SET opening_balance_cents = ${cents} WHERE id = ${accountId} RETURNING opening_balance_cents AS cents`,
    );
    return row ? Number(row.cents) : null;
  }

  /** An account's opening balance, straight from the table. */
  async function openingBalanceOf(accountId: string) {
    const result = (await db.execute(sql`SELECT opening_balance_cents AS cents FROM account WHERE id = ${accountId}`)) as unknown as {
      rows: { cents: string }[];
    };
    return Number(result.rows[0].cents);
  }

  return { db, crypto, transactions, as, householdOf, addAccount, makePrivate, deleteAccount, bookingsOf, setOpeningBalance, openingBalanceOf };
}
