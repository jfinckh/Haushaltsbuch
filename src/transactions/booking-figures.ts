import { and, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { withSession, type RlsDatabase } from "@/shared/rls";
import { notOnSavingsAccount, targetFilter, visible } from "./access";
import { spendingByGroup } from "./categories";
import type { BookingFigures, CategorySpendingsResult, MonthSummariesResult } from "./contract";
import type { TransactionKind } from "./kinds";
import { isMonth, monthOf, monthRange, shiftMonth } from "./months";
import { transaction } from "./schema";

export type BookingFiguresDeps = {
  db: RlsDatabase;
  /** Today's date (YYYY-MM-DD) for the default month. */
  today: () => string;
};

/** The longest series of months computed at once. */
const MAX_MONTHS = 24;

/**
 * The `count` months ending with `until`, newest first, and the dates they cover; null if the
 * input is invalid.
 */
function monthSeries(count: number, until: string) {
  if (!isMonth(until) || !Number.isInteger(count) || count < 1 || count > MAX_MONTHS) return null;
  const months = Array.from({ length: count }, (_, i) => shiftMonth(until, -i));
  return { months, from: monthRange(months[count - 1]).from, to: monthRange(until).to };
}

const bookingMonth = sql<string>`to_char(${transaction.bookingDate}, 'YYYY-MM')`;

/** Totals of the bookings the caller may see (documented on BookingFigures). */
export function createBookingFigures({ db, today }: BookingFiguresDeps): BookingFigures {
  const monthSummaries: BookingFigures["monthSummaries"] = async (caller, target, count, until = monthOf(today())) => {
    const series = monthSeries(count, until);
    if (!series) return { ok: false, reason: "invalid-input" };
    return withSession(db, caller, async (tx): Promise<MonthSummariesResult> => {
      const accounts = await targetFilter(tx, target);
      if (!accounts) return { ok: false, reason: "not-found" };
      const rows = await tx
        .select({ month: bookingMonth, kind: transaction.kind, sum: sql<string>`sum(${transaction.amountCents})` })
        .from(transaction)
        .where(
          and(
            visible,
            accounts,
            inArray(transaction.kind, ["income", "expense", "saving"]),
            typeof target === "string" ? undefined : or(ne(transaction.kind, "saving"), notOnSavingsAccount),
            gte(transaction.bookingDate, series.from),
            lte(transaction.bookingDate, series.to),
          ),
        )
        .groupBy(bookingMonth, transaction.kind);
      const sumOf = (m: string, kind: TransactionKind) => Number(rows.find((row) => row.month === m && row.kind === kind)?.sum ?? 0);
      return {
        ok: true,
        months: series.months.map((m) => {
          const [incomeCents, expenseCents, savingCents] = [sumOf(m, "income"), sumOf(m, "expense"), sumOf(m, "saving")];
          return { month: m, incomeCents, expenseCents, savingCents, availableCents: incomeCents + expenseCents + savingCents };
        }),
      };
    });
  };

  const categorySpendings: BookingFigures["categorySpendings"] = async (caller, target, count, until = monthOf(today())) => {
    const series = monthSeries(count, until);
    if (!series) return { ok: false, reason: "invalid-input" };
    return withSession(db, caller, async (tx): Promise<CategorySpendingsResult> => {
      const accounts = await targetFilter(tx, target);
      if (!accounts) return { ok: false, reason: "not-found" };
      const rows = await tx
        .select({ month: bookingMonth, category: transaction.category, sum: sql<string>`sum(${transaction.amountCents})` })
        .from(transaction)
        .where(
          and(
            visible,
            accounts,
            eq(transaction.kind, "expense"),
            gte(transaction.bookingDate, series.from),
            lte(transaction.bookingDate, series.to),
          ),
        )
        .groupBy(bookingMonth, transaction.category);
      return {
        ok: true,
        months: series.months.map((m) => ({
          month: m,
          ...spendingByGroup(rows.filter((row) => row.month === m).map((row) => ({ category: row.category, sumCents: Number(row.sum) }))),
        })),
      };
    });
  };

  return {
    monthSummaries,
    categorySpendings,

    async monthSummary(caller, target, month = monthOf(today())) {
      const result = await monthSummaries(caller, target, 1, month);
      return result.ok ? { ok: true, ...result.months[0] } : result;
    },

    async categorySpending(caller, target, month = monthOf(today())) {
      const result = await categorySpendings(caller, target, 1, month);
      return result.ok ? { ok: true, ...result.months[0] } : result;
    },

    async balances(caller) {
      return withSession(db, caller, async (tx) => {
        const rows = await tx
          .select({ accountId: transaction.accountId, sum: sql<string>`sum(${transaction.amountCents})` })
          .from(transaction)
          .where(visible)
          .groupBy(transaction.accountId);
        return Object.fromEntries(rows.map((row) => [row.accountId, Number(row.sum)]));
      });
    },
  };
}
