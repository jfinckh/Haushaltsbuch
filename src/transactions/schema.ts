import { sql } from "drizzle-orm";
import { bigint, check, date, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { TRANSACTION_KINDS } from "./kinds";

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
    check(
      "transaction_iban_pair_check",
      sql`(${table.counterpartyIbanEncrypted} IS NULL) = (${table.counterpartyIbanIndex} IS NULL)`,
    ),
  ],
);

export const transactionTables = { transaction };
