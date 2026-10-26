import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { rows, type RlsTransaction } from "@/shared/rls";

// households' database contract for other parts: households_current_user_household_ids()
// (drizzle/0007_households_session_rls.sql) returns the household of the session's user, if any.

/** Condition: `householdId` is the session's user's household. */
export function inCurrentHousehold(householdId: AnyColumn): SQL {
  return sql`${householdId} IN (SELECT households_current_user_household_ids())`;
}

/** The session's user's household, or null without one. */
export async function currentHouseholdId(tx: RlsTransaction): Promise<string | null> {
  const [row] = await rows<{ id: string }>(tx, sql`SELECT households_current_user_household_ids() AS id LIMIT 1`);
  return row?.id ?? null;
}
