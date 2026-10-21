import "server-only";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

// User-scoped database access. Queries run as the restricted role app_user with the caller's
// session token set for the transaction; row-level security then finds the user from that
// session in the database (auth_current_user_id, drizzle/0006_auth_session_identity.sql). Server
// code never tells the database who the user is, so it cannot act as someone else by mistake.

/** A Drizzle Postgres database (node-postgres, PGlite, ...) without a relational schema. */
export type RlsDatabase = PgDatabase<PgQueryResultHKT>;

export type RlsTransaction = Parameters<Parameters<RlsDatabase["transaction"]>[0]>[0];

/** Who is calling: the token of their signed-in session. Built by the app from the session. */
export type Caller = { readonly sessionToken: string };

/** Thrown when the caller's session does not exist (any more) or has expired. */
export class InvalidSessionError extends Error {
  constructor() {
    super("No valid session");
    this.name = "InvalidSessionError";
  }
}

/**
 * Runs `fn` in a transaction as app_user for the caller's session. `fn` gets the user id the
 * database found for that session; use it instead of any id from elsewhere. Throws
 * InvalidSessionError (and runs nothing) without a valid session.
 */
export async function withSession<T>(
  db: RlsDatabase,
  caller: Caller,
  fn: (tx: RlsTransaction, userId: string) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.session_token', ${caller.sessionToken}, true)`);
    const result = (await tx.execute(sql`SELECT auth_current_user_id() AS id`)) as unknown as {
      rows: { id: string | null }[];
    };
    const userId = result.rows[0]?.id;
    if (!userId) throw new InvalidSessionError();
    return fn(tx, userId);
  });
}
