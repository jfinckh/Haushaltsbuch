// Figures of the statistics page, computed from the month summaries (pure, no database).

import { usualDifference, type UsualDifference } from "./category-trends";

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

/** How one figure differs from another month's: cents = this month − the other (see usualDifference). */
export type FigureChange = UsualDifference;

/** How the savings rate differs, in percentage points (one decimal); below 0.5 points counts as "same". */
export type RateChange = { direction: UsualDifference["direction"]; points: number };

/**
 * How a month differs from another one, each figure the way people read it: income, money spent,
 * money saved and what is left over (positive = more of it), and the savings rate.
 */
export type FigureChanges = {
  income: FigureChange;
  spent: FigureChange;
  saved: FigureChange;
  available: FigureChange;
  /** Null when either month has no savings rate. */
  savingsRate: RateChange | null;
};

/** The figures a comparison looks at, as a statistics row has them (signed as booked). */
type Figures = Pick<StatisticsRow, "incomeCents" | "expenseCents" | "savingCents" | "availableCents" | "savingsRate">;

/** Below this many percentage points the savings rate counts as unchanged. */
const SAME_POINTS = 0.5;

/** How `current` differs from `other`; small differences count as "same", as in the category trends. */
export function compareFigures(current: Figures, other: Figures): FigureChanges {
  let savingsRate: RateChange | null = null;
  if (current.savingsRate !== null && other.savingsRate !== null) {
    const points = Math.round((current.savingsRate - other.savingsRate) * 1000) / 10;
    savingsRate = { direction: Math.abs(points) < SAME_POINTS ? "same" : points > 0 ? "more" : "less", points };
  }
  return {
    income: usualDifference(current.incomeCents, other.incomeCents),
    // "0 - x" rather than "-x", so nothing gives 0, never -0.
    spent: usualDifference(0 - current.expenseCents, 0 - other.expenseCents),
    saved: usualDifference(0 - current.savingCents, 0 - other.savingCents),
    available: usualDifference(current.availableCents, other.availableCents),
    savingsRate,
  };
}

/** How many months before the chosen one make up the usual month. */
export const USUAL_MONTHS = 3;

/** The usual month: average figures (whole cents) over `months` months with bookings. */
export type UsualMonth = Figures & { months: number };

/** Whether a month has any income, spending or saving. */
const hasBookings = (row: Figures) => row.incomeCents !== 0 || row.expenseCents !== 0 || row.savingCents !== 0;

/**
 * The average of the first USUAL_MONTHS rows with bookings (rows newest first, the chosen month
 * left out). Months without bookings, e.g. before the first import, are skipped so they don't pull
 * the average down. Null when no month has bookings.
 */
export function usualMonth(previousRows: StatisticsRow[]): UsualMonth | null {
  const months = previousRows.filter(hasBookings).slice(0, USUAL_MONTHS);
  if (months.length === 0) return null;
  const average = (pick: (row: StatisticsRow) => number) => Math.round(months.reduce((sum, row) => sum + pick(row), 0) / months.length) + 0;
  const incomeCents = average((r) => r.incomeCents);
  const savingCents = average((r) => r.savingCents);
  return {
    months: months.length,
    incomeCents,
    expenseCents: average((r) => r.expenseCents),
    savingCents,
    availableCents: average((r) => r.availableCents),
    savingsRate: savingsRate(incomeCents, savingCents),
  };
}

/** The chosen month (the first row) against the month before and against the usual month. */
export type StatisticsComparison = {
  /** Null when there is no month before or it has no bookings. */
  previous: FigureChanges | null;
  /** Null when none of the months before has bookings. */
  usual: { month: UsualMonth; changes: FigureChanges } | null;
};

/** Compares the first row (rows newest first) with the row after it and with the usual month. */
export function statisticsComparison(rows: StatisticsRow[]): StatisticsComparison {
  const [current, previous, ...rest] = rows;
  const usual = usualMonth(previous ? [previous, ...rest] : []);
  return {
    previous: current && previous && hasBookings(previous) ? compareFigures(current, previous) : null,
    usual: current && usual ? { month: usual, changes: compareFigures(current, usual) } : null,
  };
}

/** The amount a full bar stands for: the largest income or money spent of all rows, at least 1 cent. */
export function barScale(rows: StatisticsRow[]): number {
  return Math.max(1, ...rows.flatMap((r) => [r.incomeCents, -r.expenseCents]));
}
