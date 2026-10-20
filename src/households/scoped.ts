import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

// A Drizzle Postgres database (node-postgres, PGlite, ...) without a relational schema.
export type HouseholdsDatabase = PgDatabase<PgQueryResultHKT>;

export type ScopedTransaction = Parameters<Parameters<HouseholdsDatabase["transaction"]>[0]>[0];

/**
 * Runs `fn` in a transaction as the restricted role app_user with app.user_id set to `userId`,
 * so row-level security only lets through rows of that user's household.
 */
export async function asUser<T>(db: HouseholdsDatabase, userId: string, fn: (tx: ScopedTransaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
