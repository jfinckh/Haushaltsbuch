import { sql } from "drizzle-orm";
import { rows, type RlsDatabase } from "@/shared/rls";

/** Books due templates; started every hour by the app. */
export type RecurringRunner = {
  /**
   * Books every due date up to `today` (YYYY-MM-DD; default: today in Germany) and returns how many
   * bookings it created. Safe to call any time and in parallel: each date is booked once.
   */
  runDue(today?: string): Promise<number>;
};

/**
 * The hourly run has no signed-in person, so it does not use withSession. It switches to
 * recurring_runner, which may only call recurring_book_due (drizzle/0029_recurring_functions.sql)
 * and read nothing.
 */
export function createRecurringRunner({ db }: { db: RlsDatabase }): RecurringRunner {
  return {
    async runDue(today) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE recurring_runner`);
        const call = today === undefined ? sql`recurring_book_due()` : sql`recurring_book_due(${today}::date)`;
        const [row] = await rows<{ booked: number }>(tx, sql`SELECT ${call} AS booked`);
        return Number(row.booked);
      });
    },
  };
}
