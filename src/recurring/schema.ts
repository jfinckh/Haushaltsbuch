import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Tables of the recurring part. Account, booking and user ids are plain text in this file, so the
// part stays independent of accounts and transactions; the foreign keys, the grants, row-level
// security and the booking function are set up in drizzle/0029_recurring_functions.sql.

/**
 * A regular booking (salary, rent, a subscription): the booking's values and its rhythm. The texts
 * are ciphertext under the booking's own contexts (transactions' booking codec), so the booking
 * function copies them into new bookings unchanged; keys never reach the database. A template is
 * visible to whoever may see its account.
 */
export const recurringTemplate = pgTable(
  "recurring_template",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    // Integer cents; negative means money out.
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    kind: text("kind", { enum: ["expense", "income", "transfer", "saving"] }).notNull(),
    category: text("category"),
    counterpartyEncrypted: text("counterparty_encrypted"),
    counterpartyIbanEncrypted: text("counterparty_iban_encrypted"),
    counterpartyIbanIndex: text("counterparty_iban_index"),
    referenceEncrypted: text("reference_encrypted"),
    countsNextMonth: boolean("counts_next_month"),
    // Copied to the bookings: manual when a person chose the category, else auto (rules may sort it).
    classifiedBy: text("classified_by", { enum: ["auto", "manual"] }).notNull(),
    // Every 1, 3, 6 or 12 months, on this day (a missing day is the month's last day).
    intervalMonths: integer("interval_months").notNull(),
    dayOfMonth: integer("day_of_month").notNull(),
    nextDueDate: date("next_due_date", { mode: "string" }).notNull(),
    // Last day that may be booked (inclusive); null = no end.
    endDate: date("end_date", { mode: "string" }),
    paused: boolean("paused").notNull().default(false),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("recurring_template_account_idx").on(table.accountId),
    index("recurring_template_next_due_idx").on(table.nextDueDate),
    check("recurring_template_amount_check", sql`${table.amountCents} <> 0`),
    check("recurring_template_kind_check", sql`${table.kind} IN ('expense', 'income', 'transfer', 'saving')`),
    check(
      "recurring_template_category_check",
      sql`${table.category} IS NULL OR ${table.kind} IN ('expense', 'income')`,
    ),
    check(
      "recurring_template_iban_pair_check",
      sql`(${table.counterpartyIbanEncrypted} IS NULL) = (${table.counterpartyIbanIndex} IS NULL)`,
    ),
    check("recurring_template_classified_by_check", sql`${table.classifiedBy} IN ('auto', 'manual')`),
    check("recurring_template_interval_check", sql`${table.intervalMonths} IN (1, 3, 6, 12)`),
    check("recurring_template_day_check", sql`${table.dayOfMonth} BETWEEN 1 AND 31`),
    // recurring_template_due_day_check (next due date fits the day of month) needs a SQL function and
    // lives in drizzle/0029_recurring_functions.sql.
  ],
);

/**
 * One booked date of a template. The primary key makes sure a date is booked at most once, also
 * when two runs overlap. transaction_id becomes null when the booking is deleted; the date stays
 * booked, so it is not created again.
 */
export const recurringOccurrence = pgTable(
  "recurring_occurrence",
  {
    templateId: text("template_id").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    transactionId: text("transaction_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.templateId, table.dueDate] }), index("recurring_occurrence_transaction_idx").on(table.transactionId)],
);

/**
 * A suggestion a person hid ("Ausblenden"). Only a blind index of the normalized counterparty is
 * kept, never the name. Each person sees only their own rows (drizzle/0030_recurring_suggestions.sql).
 */
export const recurringSuggestionDismissal = pgTable(
  "recurring_suggestion_dismissal",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    accountId: text("account_id").notNull(),
    counterpartyIndex: text("counterparty_index").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("recurring_suggestion_dismissal_owner_idx").on(table.ownerUserId, table.accountId, table.counterpartyIndex)],
);

export const recurringTables = { recurringTemplate, recurringOccurrence, recurringSuggestionDismissal };
