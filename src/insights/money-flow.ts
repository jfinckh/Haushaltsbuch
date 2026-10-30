// A month's money flow for the statistics page: where the money came from and where it went
// (pure, no database).

import type { StatisticsRow } from "./statistics";

/** How many category groups the flow shows on their own; the rest are merged. */
export const FLOW_GROUPS = 7;

/**
 * One month's category totals as transactions' categorySpendings and categoryIncomes return them
 * (positive cents, null = without category).
 */
type GroupTotal = { group: string | null; cents: number };

export type FlowSource =
  /** Income of one category group; group null: income without category. */
  | { kind: "income"; group: string | null; cents: number }
  /**
   * refunds: refunds larger than their group's spending; fromSavings: saving taken out (net);
   * shortfall: more went out than came in, paid from the balance.
   */
  | { kind: "refunds" | "fromSavings" | "shortfall"; cents: number };

export type FlowTarget =
  | { kind: "category"; group: string; cents: number }
  /** otherCategories: the groups after the FLOW_GROUPS largest; left: what is left over. */
  | { kind: "otherCategories" | "uncategorized" | "saving" | "left"; cents: number };

/** A month's money flow. Both sides add up to totalCents; nodes without money are left out. */
export type MoneyFlow = {
  month: string;
  totalCents: number;
  /** Income per category group largest first, income without category, then refunds, fromSavings, shortfall. */
  sources: FlowSource[];
  /** Categories largest first, then otherCategories, uncategorized, saving, left. */
  targets: FlowTarget[];
};

const sum = (nodes: readonly { cents: number }[]) => nodes.reduce((total, n) => total + n.cents, 0);

/**
 * Builds the flow from the month's statistics row, its category spending and its income per
 * category group. The gap between both sides becomes "left" (equal to the row's available amount)
 * or "shortfall", so both sides are always equal. Refunds larger than their group (left out by
 * categorySpendings) are what the groups add up to beyond the money spent. Income groups at zero or
 * below (a reversed salary, rare) are not drawn.
 */
export function moneyFlow(row: StatisticsRow, spendings: GroupTotal[], incomes: GroupTotal[]): MoneyFlow {
  const positive = spendings.filter((g) => g.cents > 0);
  const earned = incomes.filter((g) => g.cents > 0);

  const sources: FlowSource[] = [
    ...earned.filter((g) => g.group !== null).sort((a, b) => b.cents - a.cents).map((g) => ({ kind: "income" as const, group: g.group, cents: g.cents })),
    { kind: "income", group: null, cents: sum(earned.filter((g) => g.group === null)) },
    { kind: "refunds", cents: Math.max(0, sum(positive) + row.expenseCents) },
    { kind: "fromSavings", cents: Math.max(0, row.savingCents) },
  ];

  const categorized = positive.filter((g): g is { group: string; cents: number } => g.group !== null).sort((a, b) => b.cents - a.cents);
  const shown = categorized.slice(0, FLOW_GROUPS);
  const targets: FlowTarget[] = [
    ...shown.map((g) => ({ kind: "category" as const, group: g.group, cents: g.cents })),
    { kind: "otherCategories", cents: sum(categorized.slice(FLOW_GROUPS)) },
    { kind: "uncategorized", cents: sum(positive.filter((g) => g.group === null)) },
    { kind: "saving", cents: Math.max(0, -row.savingCents) },
  ];

  const gap = sum(sources) - sum(targets);
  if (gap > 0) targets.push({ kind: "left", cents: gap });
  if (gap < 0) sources.push({ kind: "shortfall", cents: -gap });

  return {
    month: row.month,
    totalCents: sum(sources),
    sources: sources.filter((n) => n.cents > 0),
    targets: targets.filter((n) => n.cents > 0),
  };
}
