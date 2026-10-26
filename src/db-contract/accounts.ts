import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { rows, textArray, type RlsTransaction } from "@/shared/rls";

// accounts' database contract for other parts: the SQL functions accounts defines in its
// migrations (drizzle/0010_accounts_visible_ids.sql, 0018_rules_functions.sql,
// 0025_account_roles.sql). They read the session's user from the database, so they only ever
// return what that user may see. A private account has no household and belongs to the caller.

/** Condition: `accountId` is an account the session's user may see. */
export function visibleAccount(accountId: AnyColumn): SQL {
  return sql`${accountId} IN (SELECT accounts_visible_account_ids())`;
}

/** Whether the session's user may see the account. */
export async function accountIsVisible(tx: RlsTransaction, accountId: string): Promise<boolean> {
  const found = await rows(tx, sql`SELECT 1 AS found WHERE ${accountId} IN (SELECT accounts_visible_account_ids())`);
  return found.length > 0;
}

/** Condition: `accountId` is one of the session's user's own private accounts. */
export function ownPrivateAccount(accountId: AnyColumn): SQL {
  return sql`${accountId} IN (SELECT account_id FROM accounts_visible_account_scopes() WHERE household_id IS NULL)`;
}

/** Condition: `accountId` is not a savings account the session's user may see. */
export function notOnSavingsAccount(accountId: AnyColumn): SQL {
  return sql`${accountId} NOT IN (SELECT account_id FROM accounts_visible_account_roles() WHERE role = 'savings')`;
}

/** A visible account and its household; null household: a private account (always the caller's). */
export type AccountScope = { accountId: string; householdId: string | null };

/** The visible accounts with their household, all of them or only those among `accountIds`. */
export async function accountScopes(tx: RlsTransaction, accountIds?: readonly string[]): Promise<AccountScope[]> {
  if (accountIds?.length === 0) return [];
  const where = accountIds ? sql` WHERE account_id = ANY(${textArray(accountIds)})` : sql``;
  const found = await rows<{ account_id: string; household_id: string | null }>(
    tx,
    sql`SELECT account_id, household_id FROM accounts_visible_account_scopes()${where}`,
  );
  return found.map((row) => ({ accountId: row.account_id, householdId: row.household_id }));
}
