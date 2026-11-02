import { and, gte, lte, sql, type SQL } from "drizzle-orm";
import { SALARY_GROUP, SALARY_SHIFT_FROM_DAY } from "./counting-month";
import { monthRange, shiftMonth } from "./months";
import { transaction } from "./schema";

// The counting-month rule of counting-month.ts as SQL, for totals and lists. A test checks both
// agree (create-transactions.test.ts).

// Constants go in as literals, not parameters: the same expression is selected and grouped by, and
// Postgres only matches the two when they are written the same.
const salary = sql.raw(`'${SALARY_GROUP}'`);
const salaryChildren = sql.raw(`'${SALARY_GROUP}.%'`);
const fromDay = sql.raw(String(SALARY_SHIFT_FROM_DAY));

const shifts = sql`coalesce(
  ${transaction.countsNextMonth},
  ${transaction.kind} = 'income'
    and (${transaction.category} = ${salary} or ${transaction.category} like ${salaryChildren})
    and extract(day from ${transaction.bookingDate}) >= ${fromDay}
)`;

/** A booking's counting month as YYYY-MM. */
export const countingMonth = sql<string>`to_char(
  case when ${shifts} then date_trunc('month', ${transaction.bookingDate}) + interval '1 month'
  else ${transaction.bookingDate} end,
  'YYYY-MM'
)`;

/**
 * Bookings whose counting month lies in `from`..`to` (YYYY-MM, inclusive). The booking dates are
 * filtered first, one month wider at the start, so the date index still helps.
 */
export function inCountingMonths(from: string, to: string): SQL {
  return and(
    gte(transaction.bookingDate, monthRange(shiftMonth(from, -1)).from),
    lte(transaction.bookingDate, monthRange(to).to),
    gte(countingMonth, from),
    lte(countingMonth, to),
  ) as SQL;
}
