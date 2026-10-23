import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { CLASSIFIED_BY, TRANSACTION_KINDS } from "./kinds";

// Table of the transactions part: one row per booking. account_id is plain text in this file, so
// the part stays independent of accounts; the foreign key to account (cascade on delete), the grants
// and row-level security are set up in drizzle/0012_transactions_rls.sql. A booking is visible to
// whoever may see its account (accounts_visible_account_ids, accounts' database contract).

export const transaction = pgTable(
  "transaction",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    bookingDate: date("booking_date", { mode: "string" }).notNull(),
    // Integer cents; negative means money out.
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    kind: text("kind", { enum: TRANSACTION_KINDS }).notNull(),
    // Category key (src/transactions/categories.ts); only for expenses and income.
    category: text("category"),
    // AES-GCM ciphertext with key version (shared/field-crypto); the IBAN also has its blind index.
    counterpartyEncrypted: text("counterparty_encrypted"),
    counterpartyIbanEncrypted: text("counterparty_iban_encrypted"),
    counterpartyIbanIndex: text("counterparty_iban_index"),
    referenceEncrypted: text("reference_encrypted"),
    // Who set kind and category: the import or transfer matching (auto), a rule, or a person
    // (manual). Rules never change a manual classification.
    classifiedBy: text("classified_by", { enum: CLASSIFIED_BY }).notNull().default("auto"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("transaction_account_date_idx").on(table.accountId, table.bookingDate),
    index("transaction_counterparty_iban_index_idx").on(table.counterpartyIbanIndex),
    check("transaction_amount_check", sql`${table.amountCents} <> 0`),
    check("transaction_kind_check", sql`${table.kind} IN ('expense', 'income', 'transfer', 'saving')`),
    check(
      "transaction_category_check",
      sql`${table.category} IS NULL OR ${table.kind} IN ('expense', 'income')`,
    ),
    check("transaction_classified_by_check", sql`${table.classifiedBy} IN ('auto', 'rule', 'manual')`),
    check(
      "transaction_iban_pair_check",
      sql`(${table.counterpartyIbanEncrypted} IS NULL) = (${table.counterpartyIbanIndex} IS NULL)`,
    ),
  ],
);

/**
 * Own categories of a household (every member) or of one person (only them). Exactly one of
 * household_id and owner_user_id is set. A group has no parent_key; a subcategory's parent_key is a
 * standard group key or an own group's key (`c_<id>`) of the same scope and kind. Names are not
 * encrypted (categories stay unencrypted). Grants and row-level security: drizzle/0023_categories.sql.
 */
export const category = pgTable(
  "category",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id"),
    ownerUserId: text("owner_user_id"),
    kind: text("kind", { enum: ["expense", "income"] }).notNull(),
    parentKey: text("parent_key"),
    name: text("name").notNull(),
    archived: boolean("archived").notNull().default(false),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("category_household_idx").on(table.householdId),
    index("category_owner_idx").on(table.ownerUserId),
    check("category_scope_check", sql`(${table.householdId} IS NULL) <> (${table.ownerUserId} IS NULL)`),
    check("category_kind_check", sql`${table.kind} IN ('expense', 'income')`),
  ],
);

/** Standard category keys hidden for a household or for one person (exactly one of the two is set). */
export const hiddenCategory = pgTable(
  "hidden_category",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id"),
    ownerUserId: text("owner_user_id"),
    key: text("key").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("hidden_category_household_key_idx").on(table.householdId, table.key),
    uniqueIndex("hidden_category_owner_key_idx").on(table.ownerUserId, table.key),
    check("hidden_category_scope_check", sql`(${table.householdId} IS NULL) <> (${table.ownerUserId} IS NULL)`),
  ],
);

export const transactionTables = { transaction, category, hiddenCategory };
