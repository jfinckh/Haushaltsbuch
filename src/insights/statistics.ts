// Figures of the statistics page, computed from the month summaries (pure, no database).

/** One month as transactions' monthSummaries returns it (cents, signed as booked: money out is negative). */
type MonthSummary = { month: string; incomeCents: number; expenseCents: number; savingCents: number; availableCents: number };

/** A month's net contribution to shared accounts (cents, negative = paid in), from transfers. */
type MonthContribution = { month: string; cents: number };

export type StatisticsRow = MonthSummary & {
  /** Null for a single account; for "Alle privaten Konten" the net contribution, already in availableCents. */
  contributionCents: number | null;
  /** Saved / income as a fraction (0.125 = 12.5 %), or null without income. */
  savingsRate: number | null;
};

/**
 * Saved / net income as a fraction, or null when there is no income. Saving is booked as money out,
 * so −savingCents is what was saved. The contribution to shared accounts is not saving.
 */
export function savingsRate(incomeCents: number, savingCents: number): number | null {
  // "0 - x" rather than "-x", so nothing saved gives 0, never -0.
  return incomeCents > 0 ? (0 - savingCents) / incomeCents : null;
}

/**
 * The page's rows in the order of the summaries. With contributions (Alle privaten Konten), each month's
 * contribution lowers its available amount, as on the dashboard.
 */
export function statisticsRows(summaries: MonthSummary[], contributions?: MonthContribution[]): StatisticsRow[] {
  const byMonth = new Map(contributions?.map((c) => [c.month, c.cents]));
  return summaries.map((s) => {
    const contributionCents = contributions ? (byMonth.get(s.month) ?? 0) : null;
    return {
      ...s,
      availableCents: s.availableCents + (contributionCents ?? 0),
      contributionCents,
      savingsRate: savingsRate(s.incomeCents, s.savingCents),
    };
  });
}

/**
 * How the current month differs from the previous one: money spent (positive = spent more) and the
 * savings rate in percentage points (one decimal), or null when either month has no rate.
 */
export function compareMonths(
  current: StatisticsRow,
  previous: StatisticsRow,
): { expenseChangeCents: number; savingsRateChangePoints: number | null } {
  const rates = current.savingsRate !== null && previous.savingsRate !== null;
  return {
    expenseChangeCents: previous.expenseCents - current.expenseCents,
    savingsRateChangePoints: rates ? Math.round((current.savingsRate! - previous.savingsRate!) * 1000) / 10 : null,
  };
}

/** The amount a full bar stands for: the largest income or money spent of all rows, at least 1 cent. */
export function barScale(rows: StatisticsRow[]): number {
  return Math.max(1, ...rows.flatMap((r) => [r.incomeCents, -r.expenseCents]));
}
