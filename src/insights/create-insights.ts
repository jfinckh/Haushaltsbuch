import type { Caller } from "@/shared/rls";
import type { BookingFigures } from "@/transactions/server";
import type { Transfers } from "@/transfers/server";
import { currentBalances } from "./balances";
import { categoryTrends, TREND_MONTHS } from "./category-trends";
import type { CategoryTrendsResult, Insights, InsightsTarget, MonthFiguresResult, StatisticsResult, YearOverviewResult } from "./contract";
import { barScale, compareMonths, statisticsRows } from "./statistics";
import { yearCategories, yearTotals } from "./year-overview";

export type InsightsOptions = {
  /** Month totals and balances of the accounts the caller may see. */
  transactions: Pick<BookingFigures, "monthSummary" | "monthSummaries" | "categorySpendings" | "balances">;
  /** The contribution of the caller's own private accounts to shared accounts. */
  transfers: Pick<Transfers, "sharedContribution" | "sharedContributions">;
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

const isOwnPrivate = (target: InsightsTarget) => typeof target !== "string";

/**
 * The insights part: figures of the dashboard and the statistics page. It only combines what the
 * bookings and transfers services return in the caller's session, so it sees what the caller may see.
 */
export function createInsights({ transactions, transfers, today = localToday }: InsightsOptions): Insights {
  return {
    async monthFigures(caller: Caller, target: InsightsTarget): Promise<MonthFiguresResult> {
      const summary = await transactions.monthSummary(caller, target);
      if (!summary.ok) return summary;
      const { ok, ...figures } = summary;
      if (!isOwnPrivate(target)) return { ok, ...figures, contributionCents: null };
      const contribution = await transfers.sharedContribution(caller, summary.month);
      if (!contribution.ok) return contribution;
      return { ok, ...figures, contributionCents: contribution.cents, availableCents: figures.availableCents + contribution.cents };
    },

    async statistics(caller: Caller, target: InsightsTarget, months: number, until?: string): Promise<StatisticsResult> {
      if (until !== undefined && !isPastMonth(until, today())) return { ok: false, reason: "invalid-input" };
      const summaries = await transactions.monthSummaries(caller, target, months, until);
      if (!summaries.ok) return summaries;
      let contributions;
      if (isOwnPrivate(target)) {
        const result = await transfers.sharedContributions(caller, summaries.months.at(-1)!.month, summaries.months[0].month);
        if (!result.ok) return result;
        contributions = result.months;
      }
      const rows = statisticsRows(summaries.months, contributions);
      return {
        ok: true,
        rows,
        comparison: rows.length > 1 ? compareMonths(rows[0], rows[1]) : null,
        scaleCents: barScale(rows),
      };
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
      let contributions;
      if (isOwnPrivate(target)) {
        const result = await transfers.sharedContributions(caller, `${pad(year, 4)}-01`, until);
        if (!result.ok) return result;
        contributions = result.months;
      }
      const months = statisticsRows(summaries.months, contributions).reverse();
      return { ok: true, year, months, totals: yearTotals(months), categories: yearCategories(spendings.months) };
    },

    async balances(caller: Caller, accounts: { id: string; openingBalanceCents: number }[]): Promise<Record<string, number>> {
      return currentBalances(accounts, await transactions.balances(caller));
    },
  };
}

