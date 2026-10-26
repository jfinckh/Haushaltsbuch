import { and, eq, sql, type SQL } from "drizzle-orm";
import type { RlsTransaction } from "@/shared/rls";
import { isCategoryFor, ownCategoryId } from "./categories";
import type { AccountTarget, CategoryTarget } from "./contract";
import type { TransactionKind } from "./kinds";
import { category, transaction } from "./schema";

// Which bookings, accounts and categories the caller may see and use. The SQL functions are
// accounts' database contract; row-level security applies the same rules.

/** Bookings of accounts the session's user may see. */
export const visible: SQL = sql`${transaction.accountId} IN (SELECT accounts_visible_account_ids())`;

/**
 * The caller's own private accounts (a private account has no household and is visible to its
 * owner only), never shared ones.
 */
export const ownPrivate: SQL = sql`${transaction.accountId} IN (SELECT account_id FROM accounts_visible_account_scopes() WHERE household_id IS NULL)`;

/**
 * Bookings outside the caller's visible savings accounts. Within the own private accounts, a saving
 * booking on a savings account is the other side of one on an everyday account, so only the
 * everyday side counts.
 */
export const notOnSavingsAccount: SQL = sql`${transaction.accountId} NOT IN (SELECT account_id FROM accounts_visible_account_roles() WHERE role = 'savings')`;

export async function accountIsVisible(tx: RlsTransaction, accountId: string): Promise<boolean> {
  const result = (await tx.execute(
    sql`SELECT 1 AS found WHERE ${accountId} IN (SELECT accounts_visible_account_ids())`,
  )) as unknown as { rows: unknown[] };
  return result.rows.length > 0;
}

/** A visible booking by id, or null; `lock` locks its row for update. */
export async function findVisible(tx: RlsTransaction, id: string, lock = false) {
  const query = tx
    .select()
    .from(transaction)
    .where(and(eq(transaction.id, id), visible));
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

/** The bookings condition for a target, or null if it is a single account the caller cannot see. */
export async function targetFilter(tx: RlsTransaction, target: AccountTarget): Promise<SQL | null> {
  if (typeof target !== "string") return ownPrivate;
  return (await accountIsVisible(tx, target)) ? eq(transaction.accountId, target) : null;
}

/**
 * Whether `key` may be set as the category of a `kind` booking on a visible account (or for a whole
 * scope): a standard key of that type, or an own category the caller may see (row-level security) of
 * that type, not archived unless `allowArchived`, with a personal one only on the caller's own
 * private accounts.
 */
export async function categoryAllowed(
  tx: RlsTransaction,
  target: CategoryTarget,
  kind: TransactionKind,
  key: string,
  { allowArchived = false }: { allowArchived?: boolean } = {},
): Promise<boolean> {
  let isPrivate: boolean;
  if (typeof target === "string") {
    const scopes = (await tx.execute(
      sql`SELECT household_id FROM accounts_visible_account_scopes() WHERE account_id = ${target}`,
    )) as unknown as { rows: { household_id: string | null }[] };
    const account = scopes.rows[0];
    if (!account) return false;
    isPrivate = account.household_id === null;
  } else {
    isPrivate = target.visibility === "private";
  }
  if (isCategoryFor(kind, key)) return true;
  const id = ownCategoryId(key);
  if (!id) return false;
  const [row] = await tx.select().from(category).where(eq(category.id, id));
  if (!row || row.kind !== kind || (row.archived && !allowArchived)) return false;
  if (key !== (row.parentKey ? `${row.parentKey}.c_${row.id}` : `c_${row.id}`)) return false;
  const parentId = row.parentKey && ownCategoryId(row.parentKey);
  if (parentId) {
    const [parent] = await tx.select().from(category).where(eq(category.id, parentId));
    if (!parent || (parent.archived && !allowArchived)) return false;
  }
  return row.ownerUserId === null || isPrivate;
}
