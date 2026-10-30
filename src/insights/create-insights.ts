import type { Caller } from "@/shared/rls";
import type { BookingFigures } from "@/transactions/server";
import { currentBalances } from "./balances";
import { categoryTrends, TREND_MONTHS } from "./category-trends";
import type { CategoryTrendsResult, Insights, InsightsTarget, MoneyFlowResult, MonthFiguresResult, StatisticsResult, YearOverviewResult } from "./contract";
import { moneyFlow } from "./money-flow";
import { barScale, statisticsComparison, statisticsRows } from "./statistics";
import { yearCategories, yearTotals } from "./year-overview";

export type InsightsOptions = {
  /** Month totals and balances of the accounts the caller may see. */
  transactions: Pick<BookingFigures, "monthSummary" | "monthSummaries" | "categorySpendings" | "categoryIncomes" | "balances">;
  /** Today's date (YYYY-MM-DD), for the current year. Default: the local date. */
  today?: () => string;
};

/** The earliest year the overview accepts. */
const FIRST_YEAR = 1970;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Today's date (YYYY-MM-DD) in the local time zone. */
function localToday(): string {
  const now = new Date();
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whether `month` is a valid YYYY-MM month no later than the month of `today` (YYYY-MM-DD). */
function isPastMonth(month: string, today: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= `${FIRST_YEAR}-01` && month <= today.slice(0, 7);
}

/**
 * The insights part: figures of the dashboard and the statistics page. It only combines what the
 * bookings service returns in the caller's session, so it sees what the caller may see.
 */
export function createInsights({ transactions, today = localToday }: InsightsOptions): Insights {
  return {
    async monthFigures(caller: Caller, target: InsightsTarget): Promise<MonthFiguresResult> {
      const summary = await transactions.monthSummary(caller, target);
      if (!summary.ok) return summary;
      return summary;
    },

    async statistics(caller: Caller, target: InsightsTarget, months: number, until?: string): Promise<StatisticsResult> {
      if (until !== undefined && !isPastMonth(until, today())) return { ok: false, reason: "invalid-input" };
      const summaries = await transactions.monthSummaries(caller, target, months, until);
      if (!summaries.ok) return summaries;
      const rows = statisticsRows(summaries.months);
      return {
        ok: true,
        rows,
        comparison: statisticsComparison(rows),
        running: rows[0].month === today().slice(0, 7),
        scaleCents: barScale(rows),
      };
    },

    async moneyFlow(caller: Caller, target: InsightsTarget, month?: string): Promise<MoneyFlowResult> {
      if (month !== undefined && !isPastMonth(month, today())) return { ok: false, reason: "invalid-input" };
      const [summaries, spendings, incomes] = await Promise.all([
        transactions.monthSummaries(caller, target, 1, month),
        transactions.categorySpendings(caller, target, 1, month),
        transactions.categoryIncomes(caller, target, 1, month),
      ]);
      if (!summaries.ok) return summaries;
      if (!spendings.ok) return spendings;
      if (!incomes.ok) return incomes;
      const [row] = statisticsRows(summaries.months);
      return { ok: true, ...moneyFlow(row, spendings.months[0]?.groups ?? [], incomes.months[0]?.groups ?? []) };
    },

    async categoryTrends(caller: Caller, target: InsightsTarget, until?: string): Promise<CategoryTrendsResult> {
      if (until !== undefined && !isPastMonth(until, today())) return { ok: false, reason: "invalid-input" };
      // The month and the 12 months before it.
      const spendings = await transactions.categorySpendings(caller, target, TREND_MONTHS + 1, until);
      if (!spendings.ok) return spendings;
      return { ok: true, ...categoryTrends(spendings.months) };
    },

    async yearOverview(caller: Caller, target: InsightsTarget, year: number): Promise<YearOverviewResult> {
      const [currentYear, currentMonth] = today().split("-").map(Number);
      if (!Number.isInteger(year) || year < FIRST_YEAR || year > currentYear) return { ok: false, reason: "invalid-input" };
      const count = year === currentYear ? currentMonth : 12;
      const until = `${pad(year, 4)}-${pad(count)}`;
      const [summaries, spendings] = await Promise.all([
        transactions.monthSummaries(caller, target, count, until),
        transactions.categorySpendings(caller, target, count, until),
      ]);
      if (!summaries.ok) return summaries;
      if (!spendings.ok) return spendings;
      const months = statisticsRows(summaries.months).reverse();
      return { ok: true, year, months, totals: yearTotals(months), categories: yearCategories(spendings.months) };
    },

    async balances(caller: Caller, accounts: { id: string; openingBalanceCents: number }[]): Promise<Record<string, number>> {
      return currentBalances(accounts, await transactions.balances(caller));
    },
  };
}

