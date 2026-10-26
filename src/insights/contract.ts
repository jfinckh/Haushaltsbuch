import type { Caller } from "@/shared/rls";
import type { CategoryTrends } from "./category-trends";
import type { MonthComparison, StatisticsRow } from "./statistics";
import type { YearTotals } from "./year-overview";

export type { StatisticsRow } from "./statistics";

// The contract of the insights part. createInsights implements it.

/** One visible account, or all of the caller's own private accounts together ("Alle privaten Konten"). */
export type InsightsTarget = string | { ownPrivate: true };

type Failure = { ok: false; reason: "invalid-input" | "not-found" };

/** The dashboard's current month (cents, signed as booked: money out is negative). */
export type MonthFigures = {
  month: string;
  incomeCents: number;
  expenseCents: number;
  savingCents: number;
  /** Null for a single account; for "Alle privaten Konten" the net contribution to shared accounts. */
  contributionCents: number | null;
  /** Income − expenses − saving, and for "Alle privaten Konten" also minus the contribution. */
  availableCents: number;
};

export type MonthFiguresResult = ({ ok: true } & MonthFigures) | Failure;

export type StatisticsResult =
  | {
      ok: true;
      /** One row per calendar month, newest first. */
      rows: StatisticsRow[];
      /** The newest month compared with the one before, or null with a single month. */
      comparison: MonthComparison | null;
      /** The amount a full bar stands for. */
      scaleCents: number;
    }
  | Failure;

export type CategoryTrendsResult = ({ ok: true } & CategoryTrends) | Failure;

export type YearOverviewResult =
  | {
      ok: true;
      year: number;
      /** The year's months up to the current one, January first. */
      months: StatisticsRow[];
      totals: YearTotals;
      /** Spending per category group over these months, largest first. */
      categories: { totalCents: number; groups: { group: string | null; cents: number }[] };
    }
  | Failure;

/**
 * Figures of the dashboard and the statistics page. Combines what the bookings and transfers
 * services return in the caller's session, so it sees what the caller may see.
 */
export interface Insights {
  /** The current month of one account or of "Alle privaten Konten", as the dashboard shows it. */
  monthFigures(caller: Caller, target: InsightsTarget): Promise<MonthFiguresResult>;

  /**
   * The `months` (1–24) calendar months up to `until` (YYYY-MM, default: the current month), as the
   * statistics page shows them. A month after the current one gives invalid-input.
   */
  statistics(caller: Caller, target: InsightsTarget, months: number, until?: string): Promise<StatisticsResult>;

  /**
   * Spending per category group over the 12 calendar months up to `until` (YYYY-MM, default: the
   * current month), its monthly averages over the 3, 6 and 12 months before `until`, and how
   * `until` differs from the usual. Same definition as the dashboard's spending by category: only
   * expenses, refunds lower their group. A month after the current one gives invalid-input.
   */
  categoryTrends(caller: Caller, target: InsightsTarget, until?: string): Promise<CategoryTrendsResult>;

  /**
   * One calendar year (up to the current month in the current year): its months January first,
   * the year's totals and its spending per category group. Same definitions as the statistics rows
   * and the category trends. A future year or one before 1970 gives invalid-input.
   */
  yearOverview(caller: Caller, target: InsightsTarget, year: number): Promise<YearOverviewResult>;

  /**
   * The current balance of each given account: opening balance plus the bookings the caller may see.
   * Pass only accounts the caller may see (e.g. from accounts' list).
   */
  balances(caller: Caller, accounts: { id: string; openingBalanceCents: number }[]): Promise<Record<string, number>>;
}
