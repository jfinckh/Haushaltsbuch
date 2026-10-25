// Category trends and average spending of the statistics page, from transactions' monthly category
// spending (pure, no database).

/** How many calendar months the trend shows, including the current one. */
export const TREND_MONTHS = 12;

/** The averages cover this many months before the trend's last month. */
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
  /** The trend's last month against the 3-month average. */
  difference: UsualDifference;
};

/** How a month's spending differs from the usual (the 3-month average); cents = month − average. */
export type UsualDifference = { direction: "more" | "less" | "same"; cents: number };

/** Differences below 10 € or below 10 % of the average count as "same". */
const SAME_CENTS = 1000;
const SAME_SHARE = 0.1;

/** Whether `cents` is more, less or about the same as `averageCents`. */
export function usualDifference(cents: number, averageCents: number): UsualDifference {
  const difference = cents - averageCents;
  const threshold = Math.max(SAME_CENTS, Math.round(averageCents * SAME_SHARE));
  if (Math.abs(difference) < threshold) return { direction: "same", cents: difference };
  return { direction: difference > 0 ? "more" : "less", cents: difference };
}

export type CategoryTrends = {
  /** The trend months (YYYY-MM), oldest first, ending with the current month. */
  months: string[];
  /**
   * Groups with spending in the last trend month or in the 3 months before it; the last month's
   * largest first, then the largest 3-month average.
   */
  groups: CategoryTrend[];
};

/**
 * Folds the category spending of a month and the 12 before it (newest first, as categorySpendings
 * returns them) into a trend per group, its averages over the months before it and its difference
 * from the usual.
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
    const trend = trendMonths.map((month) => centsOf(month, group));
    const difference = usualDifference(trend.at(-1) ?? 0, average3Cents);
    return { group, trend, average3Cents, average6Cents, average12Cents, difference };
  });
  const last = (g: CategoryTrend) => g.trend.at(-1) ?? 0;
  return {
    months: trendMonths.map((m) => m.month),
    groups: groups
      .filter((g) => last(g) > 0 || g.average3Cents > 0)
      .sort((a, b) => last(b) - last(a) || b.average3Cents - a.average3Cents),
  };
}
