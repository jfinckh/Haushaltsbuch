import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Table of the rules part. Account, household and user ids are plain text in this file, so the part
// stays independent of accounts, households and auth; the foreign keys (cascade on delete), the
// grants and row-level security are set up in drizzle/0018_rules_functions.sql.

/**
 * A rule that sorts bookings: a condition (counterparty and/or reference contains a text, optionally
 * the sign of the amount) and a result (type, category, transfer target). Exactly one scope: one
 * account, the household's shared accounts, or the owner's private accounts. The patterns are
 * encrypted at field level (they hold names and parts of references).
 */
export const bookingRule = pgTable(
  "booking_rule",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id"),
    householdId: text("household_id"),
    ownerUserId: text("owner_user_id"),
    counterpartyPatternEncrypted: text("counterparty_pattern_encrypted"),
    referencePatternEncrypted: text("reference_pattern_encrypted"),
    amountSign: text("amount_sign", { enum: ["negative", "positive"] }),
    resultKind: text("result_kind", { enum: ["expense", "income", "transfer", "saving"] }).notNull(),
    resultCategory: text("result_category"),
    transferTarget: text("transfer_target", { enum: ["external"] }),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("booking_rule_account_idx").on(table.accountId),
    index("booking_rule_household_idx").on(table.householdId),
    index("booking_rule_owner_idx").on(table.ownerUserId),
    check(
      "booking_rule_scope_check",
      sql`num_nonnulls(${table.accountId}, ${table.householdId}, ${table.ownerUserId}) = 1`,
    ),
    check(
      "booking_rule_pattern_check",
      sql`${table.counterpartyPatternEncrypted} IS NOT NULL OR ${table.referencePatternEncrypted} IS NOT NULL`,
    ),
    check("booking_rule_sign_check", sql`${table.amountSign} IS NULL OR ${table.amountSign} IN ('negative', 'positive')`),
    check("booking_rule_kind_check", sql`${table.resultKind} IN ('expense', 'income', 'transfer', 'saving')`),
    check(
      "booking_rule_category_check",
      sql`${table.resultCategory} IS NULL OR ${table.resultKind} IN ('expense', 'income')`,
    ),
    check(
      "booking_rule_target_check",
      sql`${table.transferTarget} IS NULL OR (${table.transferTarget} = 'external' AND ${table.resultKind} IN ('transfer', 'saving'))`,
    ),
  ],
);

export const ruleTables = { bookingRule };
