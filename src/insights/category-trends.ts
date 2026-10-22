// Category trends and average spending of the statistics page, from transactions' monthly category
// spending (pure, no database).

/** How many calendar months the trend shows, including the current one. */
export const TREND_MONTHS = 12;

/** The averages cover this many complete months (the current month is never complete). */
const AVERAGE_SPANS = [3, 6, 12] as const;

/** One month as transactions' categorySpendings returns it: positive cents per group, null = uncategorized. */
type MonthSpending = { month: string; groups: { group: string | null; cents: number }[] };

export type CategoryTrend = {
  /** Category group key; null for expenses without category. */
  group: string | null;
  /** Spending per trend month (cents), oldest first, as `months` of the result. */
  trend: number[];
  /** Average monthly spending over the last 3, 6 and 12 complete months (whole cents). */
  average3Cents: number;
  average6Cents: number;
  average12Cents: number;
};

export type CategoryTrends = {
  /** The trend months (YYYY-MM), oldest first, ending with the current month. */
  months: string[];
  /** Groups with any spending in these months, largest 12-month average first. */
  groups: CategoryTrend[];
};

/**
 * Folds the category spending of the current month and the 12 before it (newest first, as
 * categorySpendings returns them) into a trend per group and its averages over complete months.
 */
export function categoryTrends(spendings: MonthSpending[]): CategoryTrends {
  const centsOf = (month: MonthSpending, group: string | null) => month.groups.find((g) => g.group === group)?.cents ?? 0;
  const keys = [...new Set(spendings.flatMap((m) => m.groups.map((g) => g.group)))];
  const trendMonths = spendings.slice(0, TREND_MONTHS).reverse();
  const complete = spendings.slice(1);
  const average = (group: string | null, span: number) =>
    Math.round(complete.slice(0, span).reduce((sum, month) => sum + centsOf(month, group), 0) / span);

  const groups = keys.map((group) => {
    const [average3Cents, average6Cents, average12Cents] = AVERAGE_SPANS.map((span) => average(group, span));
    return { group, trend: trendMonths.map((month) => centsOf(month, group)), average3Cents, average6Cents, average12Cents };
  });
  const trendTotal = (g: CategoryTrend) => g.trend.reduce((sum, cents) => sum + cents, 0);
  groups.sort((a, b) => b.average12Cents - a.average12Cents || trendTotal(b) - trendTotal(a));
  return { months: trendMonths.map((m) => m.month), groups };
}
