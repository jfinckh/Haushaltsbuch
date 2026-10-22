import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Table of the budgets part. account_id is plain text in this file, so the part stays independent of
// accounts; the foreign key (cascade on delete), the grants and row-level security are appended to
// drizzle/0019_budgets.sql. A budget is visible to whoever may see its account
// (accounts_visible_account_ids, accounts' database contract).

/** A monthly limit for one expense category (group or subcategory key) of one account. */
export const budget = pgTable(
  "budget",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    category: text("category").notNull(),
    // Integer cents per calendar month.
    limitCents: bigint("limit_cents", { mode: "number" }).notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("budget_account_category_idx").on(table.accountId, table.category),
    check("budget_limit_check", sql`${table.limitCents} > 0`),
  ],
);

export const budgetTables = { budget };
