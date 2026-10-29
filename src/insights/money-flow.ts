// A month's money flow for the statistics page: where the money came from and where it went
// (pure, no database).

import type { StatisticsRow } from "./statistics";

/** How many category groups the flow shows on their own; the rest are merged. */
export const FLOW_GROUPS = 7;

/** One month's category spending as transactions' categorySpendings returns it (positive cents, null = uncategorized). */
type GroupSpending = { group: string | null; cents: number };

export type FlowSource = {
  /**
   * income; refunds: refunds larger than their group's spending; fromSavings: saving taken out (net);
   * fromShared: money back from shared accounts (Alle privaten Konten); shortfall: more went out than
   * came in, paid from the balance.
   */
  kind: "income" | "refunds" | "fromSavings" | "fromShared" | "shortfall";
  cents: number;
};

export type FlowTarget =
  | { kind: "category"; group: string; cents: number }
  /** otherCategories: the groups after the FLOW_GROUPS largest; left: what is left over. */
  | { kind: "otherCategories" | "uncategorized" | "saving" | "toShared" | "left"; cents: number };

/** A month's money flow. Both sides add up to totalCents; nodes without money are left out. */
export type MoneyFlow = {
  month: string;
  totalCents: number;
  /** In a fixed order: income, refunds, fromSavings, fromShared, shortfall. */
  sources: FlowSource[];
  /** Categories largest first, then otherCategories, uncategorized, saving, toShared, left. */
  targets: FlowTarget[];
};

/**
 * Builds the flow from the month's statistics row and its category spending. The gap between both
 * sides becomes "left" (equal to the row's available amount) or "shortfall", so both sides are
 * always equal. Refunds larger than their group (left out by categorySpendings) are what the groups
 * add up to beyond the money spent. Negative income (a reversed salary, rare) is not drawn.
 */
export function moneyFlow(row: StatisticsRow, groups: GroupSpending[]): MoneyFlow {
  const positive = groups.filter((g) => g.cents > 0);
  const groupsCents = positive.reduce((sum, g) => sum + g.cents, 0);
  const contribution = row.contributionCents ?? 0;

  const sources: FlowSource[] = [
    { kind: "income", cents: Math.max(0, row.incomeCents) },
    { kind: "refunds", cents: Math.max(0, groupsCents + row.expenseCents) },
    { kind: "fromSavings", cents: Math.max(0, row.savingCents) },
    { kind: "fromShared", cents: Math.max(0, contribution) },
  ];

  const categorized = positive.filter((g): g is { group: string; cents: number } => g.group !== null).sort((a, b) => b.cents - a.cents);
  const shown = categorized.slice(0, FLOW_GROUPS);
  const otherCents = categorized.slice(FLOW_GROUPS).reduce((sum, g) => sum + g.cents, 0);
  const targets: FlowTarget[] = [
    ...shown.map((g) => ({ kind: "category" as const, group: g.group, cents: g.cents })),
    { kind: "otherCategories", cents: otherCents },
    { kind: "uncategorized", cents: positive.filter((g) => g.group === null).reduce((sum, g) => sum + g.cents, 0) },
    { kind: "saving", cents: Math.max(0, -row.savingCents) },
    { kind: "toShared", cents: Math.max(0, -contribution) },
  ];

  const sum = (nodes: { cents: number }[]) => nodes.reduce((total, n) => total + n.cents, 0);
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
