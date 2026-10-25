// The yearly overview of the statistics page, from the month rows and the monthly category spending
// (pure, no database).

import { savingsRate, type StatisticsRow } from "./statistics";

export type YearTotals = {
  incomeCents: number;
  expenseCents: number;
  savingCents: number;
  /** Null for a single account; for "Alle privaten Konten" the year's net contribution to shared accounts. */
  contributionCents: number | null;
  availableCents: number;
  /** Saved / income of the whole year, or null without income. */
  savingsRate: number | null;
};

type GroupSpending = { group: string | null; cents: number };

/** The year's totals: the sums of its month rows, and the savings rate of those sums. */
export function yearTotals(rows: StatisticsRow[]): YearTotals {
  const sum = (pick: (row: StatisticsRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const incomeCents = sum((r) => r.incomeCents);
  const savingCents = sum((r) => r.savingCents);
  const withContribution = rows.some((r) => r.contributionCents !== null);
  return {
    incomeCents,
    expenseCents: sum((r) => r.expenseCents),
    savingCents,
    contributionCents: withContribution ? sum((r) => r.contributionCents ?? 0) : null,
    availableCents: sum((r) => r.availableCents),
    savingsRate: savingsRate(incomeCents, savingCents),
  };
}

/**
 * Spending per category group over the year: the sum of each month's spending (as transactions'
 * categorySpendings gives it), largest first. The total is the sum of the groups.
 */
export function yearCategories(months: readonly { groups: readonly GroupSpending[] }[]): { totalCents: number; groups: GroupSpending[] } {
  const byGroup = new Map<string | null, number>();
  for (const { group, cents } of months.flatMap((m) => m.groups)) byGroup.set(group, (byGroup.get(group) ?? 0) + cents);
  const groups = [...byGroup].map(([group, cents]) => ({ group, cents })).sort((a, b) => b.cents - a.cents);
  return { totalCents: groups.reduce((total, g) => total + g.cents, 0), groups };
}
