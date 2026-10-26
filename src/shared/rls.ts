import "server-only";
import { sql, type SQL } from "drizzle-orm";
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

/**
 * The rows of a raw SQL query (e.g. a call of a database function). The one place that reads the
 * driver's raw result, so callers state the row type instead of casting.
 */
export async function rows<T>(tx: RlsTransaction, query: SQL): Promise<T[]> {
  return ((await tx.execute(query)) as unknown as { rows: T[] }).rows;
}

/** A Postgres text[] literal from ids, as bound parameters. */
export function textArray(ids: readonly string[]): SQL {
  return ids.length === 0 ? sql`ARRAY[]::text[]` : sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::text[]`;
}

/** Thrown when the caller's session does not exist (any more) or has expired. */
export class InvalidSessionError extends Error {
  constructor() {
    super("No valid session");
    this.name = "InvalidSessionError";
  }
}

/**
 * Thrown instead of a failed database query inside withSession. Drizzle's own error puts the SQL and
 * every parameter (amounts, dates, ciphertext, ids) into its message, which would end up in logs.
 * This one keeps only the Postgres error code (SQLSTATE), e.g. "23505" for a unique violation.
 */
export class DatabaseQueryError extends Error {
  readonly code: string | null;
  constructor(code: string | null) {
    super(`Database query failed (${code ?? "unknown"})`);
    this.name = "DatabaseQueryError";
    this.code = code;
  }
}

/** A failed query (Drizzle's query error, or the driver's error with a SQLSTATE), else null. */
function queryFailure(error: unknown): { code: string | null } | null {
  let code: string | null = null;
  let isQueryError = false;
  for (let e = error, depth = 0; e && typeof e === "object" && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if ("query" in e && "params" in e) isQueryError = true;
    const value = (e as { code?: unknown }).code;
    if (code === null && typeof value === "string" && /^[0-9A-Z]{5}$/.test(value)) {
      code = value;
      isQueryError = true;
    }
  }
  return isQueryError ? { code } : null;
}

/**
 * Runs `fn` in a transaction as app_user for the caller's session. `fn` gets the user id the
 * database found for that session; use it instead of any id from elsewhere. Throws
 * InvalidSessionError (and runs nothing) without a valid session. A failed query becomes a
 * DatabaseQueryError without the query's values.
 */
export async function withSession<T>(
  db: RlsDatabase,
  caller: Caller,
  fn: (tx: RlsTransaction, userId: string) => Promise<T>,
): Promise<T> {
  try {
    return await runAsSession(db, caller, fn);
  } catch (error) {
    if (error instanceof InvalidSessionError || error instanceof DatabaseQueryError) throw error;
    const failure = queryFailure(error);
    // Not `cause: error`: the cause would carry the query and its values into the logs again.
    if (failure) throw new DatabaseQueryError(failure.code);
    throw error;
  }
}

async function runAsSession<T>(
  db: RlsDatabase,
  caller: Caller,
  fn: (tx: RlsTransaction, userId: string) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.session_token', ${caller.sessionToken}, true)`);
    const [row] = await rows<{ id: string | null }>(tx, sql`SELECT auth_current_user_id() AS id`);
    const userId = row?.id;
    if (!userId) throw new InvalidSessionError();
    return fn(tx, userId);
  });
}
