import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { withSession, type Caller, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import type { BookingStore } from "@/transactions/server";
import type { Budgets, BudgetView, ListBudgetsResult, SaveBudgetResult } from "./contract";
import { budget } from "./schema";
import { createBudgetSchema, monthSchema, updateBudgetSchema } from "./validation";

export type BudgetsOptions = {
  db: RlsDatabase;
  /** Reads the monthly expense totals of an account and checks a budget's category. */
  transactions: Pick<BookingStore, "expenseTotals" | "checkCategory">;
};

type BudgetRow = typeof budget.$inferSelect;

/** Budgets of accounts the session's user may see (accounts' database contract). RLS applies the same rule. */
const visible: SQL = sql`${budget.accountId} IN (SELECT accounts_visible_account_ids())`;

async function accountIsVisible(tx: RlsTransaction, accountId: string): Promise<boolean> {
  const result = (await tx.execute(
    sql`SELECT 1 AS found WHERE ${accountId} IN (SELECT accounts_visible_account_ids())`,
  )) as unknown as { rows: unknown[] };
  return result.rows.length > 0;
}

/** Spending of one budget: the totals of its category key and, for a group, of its subcategories. */
function spentFor(category: string, totals: Record<string, number>): number {
  const net = Object.entries(totals)
    .filter(([key]) => key === category || key.startsWith(`${category}.`))
    .reduce((sum, [, cents]) => sum + cents, 0);
  return net === 0 ? 0 : -net;
}

const toView = (row: BudgetRow, spentCents: number): BudgetView => ({
  id: row.id,
  accountId: row.accountId,
  category: row.category,
  limitCents: row.limitCents,
  spentCents,
});

/** The budgets part. Every call is about the caller's own view; their user id comes from the database. */
export function createBudgets({ db, transactions }: BudgetsOptions): Budgets {
  /** The view of a stored budget with its spending in the current month. */
  async function currentView(tx: RlsTransaction, row: BudgetRow): Promise<BudgetView> {
    const { totals } = await transactions.expenseTotals(tx, row.accountId);
    return toView(row, spentFor(row.category, totals));
  }

  return {
    async listBudgets(caller: Caller, accountId: string, month?: string): Promise<ListBudgetsResult> {
      const parsed = monthSchema.safeParse(month);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      return withSession(db, caller, async (tx): Promise<ListBudgetsResult> => {
        if (!(await accountIsVisible(tx, accountId))) return { ok: false, reason: "not-found" };
        const rows = await tx
          .select()
          .from(budget)
          .where(and(eq(budget.accountId, accountId), visible))
          .orderBy(asc(budget.category));
        const { month: listed, totals } = await transactions.expenseTotals(tx, accountId, parsed.data);
        return { ok: true, month: listed, budgets: rows.map((row) => toView(row, spentFor(row.category, totals))) };
      });
    },

    async createBudget(caller: Caller, input: unknown): Promise<SaveBudgetResult> {
      const parsed = createBudgetSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const { accountId, category, limit } = parsed.data;
      return withSession(db, caller, async (tx, userId): Promise<SaveBudgetResult> => {
        if (!(await accountIsVisible(tx, accountId))) return { ok: false, reason: "not-found" };
        // A standard or own expense category that fits the account (own ones: visible, active, personal only on private accounts).
        if (!(await transactions.checkCategory(tx, accountId, "expense", category))) return { ok: false, reason: "invalid-input" };
        const [row] = await tx
          .insert(budget)
          .values({ id: crypto.randomUUID(), accountId, category, limitCents: limit, createdByUserId: userId })
          .onConflictDoNothing()
          .returning();
        if (!row) return { ok: false, reason: "duplicate" };
        return { ok: true, budget: await currentView(tx, row) };
      });
    },

    async updateBudget(caller: Caller, id: string, input: unknown): Promise<SaveBudgetResult> {
      const parsed = updateBudgetSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      return withSession(db, caller, async (tx): Promise<SaveBudgetResult> => {
        const [row] = await tx
          .update(budget)
          .set({ limitCents: parsed.data.limit, updatedAt: new Date() })
          .where(and(eq(budget.id, id), visible))
          .returning();
        if (!row) return { ok: false, reason: "not-found" };
        return { ok: true, budget: await currentView(tx, row) };
      });
    },

    async deleteBudget(caller: Caller, id: string): Promise<boolean> {
      return withSession(db, caller, async (tx) => {
        const deleted = await tx
          .delete(budget)
          .where(and(eq(budget.id, id), visible))
          .returning({ id: budget.id });
        return deleted.length > 0;
      });
    },
  };
}

