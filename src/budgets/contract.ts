import type { Caller } from "@/shared/rls";

// The contract of the budgets part. createBudgets implements it.

/** A budget as callers see it, with its spending in the listed month. No user ids. */
export type BudgetView = {
  id: string;
  accountId: string;
  /** Expense category key: a group covers its subcategories. */
  category: string;
  limitCents: number;
  /** Expenses minus refunds in the month (cents); below 0 if refunds were larger. */
  spentCents: number;
};

export type ListBudgetsResult =
  | { ok: true; month: string; budgets: BudgetView[] }
  | { ok: false; reason: "invalid-input" | "not-found" };

export type SaveBudgetResult =
  | { ok: true; budget: BudgetView }
  | { ok: false; reason: "invalid-input" | "not-found" | "duplicate" };

/** Budgets. Every call is about the caller's own view; their user id comes from the database. */
export interface Budgets {
  /** An account's budgets with their spending in a calendar month (default: the current one). */
  listBudgets(caller: Caller, accountId: string, month?: string): Promise<ListBudgetsResult>;

  /** Adds a budget to an account the caller may see; one per account and category. */
  createBudget(caller: Caller, input: unknown): Promise<SaveBudgetResult>;

  /** Changes the limit of a visible budget. */
  updateBudget(caller: Caller, id: string, input: unknown): Promise<SaveBudgetResult>;

  /** Deletes a visible budget; false if there is none the caller may see. */
  deleteBudget(caller: Caller, id: string): Promise<boolean>;
}
