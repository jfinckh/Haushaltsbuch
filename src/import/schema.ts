import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Tables of the import part. Account and booking ids are plain text in this file, so the part stays
// independent of accounts and transactions; the foreign keys (cascade on delete), the grants and
// row-level security are set up in drizzle/0014_import_rls.sql. An import is visible to whoever may
// see its account (accounts_visible_account_ids, accounts' database contract).

/** One confirmed upload. Deleting it (undo) removes its rows; the bookings are removed first. */
export const importBatch = pgTable(
  "import",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    bank: text("bank", { enum: ["ing", "trade_republic"] }).notNull(),
    // AES-GCM ciphertext with key version (shared/field-crypto).
    fileNameEncrypted: text("file_name_encrypted").notNull(),
    fileEncrypted: text("file_encrypted").notNull(),
    periodFrom: date("period_from", { mode: "string" }),
    periodTo: date("period_to", { mode: "string" }),
    rowCount: integer("row_count").notNull(),
    newCount: integer("new_count").notNull(),
    duplicateCount: integer("duplicate_count").notNull(),
    skippedCount: integer("skipped_count").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("import_account_id_idx").on(table.accountId, table.createdAt),
    check("import_bank_check", sql`${table.bank} IN ('ing', 'trade_republic')`),
  ],
);

/**
 * One booking an import created, with its fingerprint (blind index) and the raw row (encrypted). The
 * fingerprint is unique per account, so the same booking is never imported twice. Deleting the
 * booking by hand deletes this row too, so a later import brings the booking back.
 */
export const importRow = pgTable(
  "import_row",
  {
    id: text("id").primaryKey(),
    importId: text("import_id").notNull(),
    accountId: text("account_id").notNull(),
    transactionId: text("transaction_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    line: integer("line").notNull(),
    rawEncrypted: text("raw_encrypted").notNull(),
  },
  (table) => [
    uniqueIndex("import_row_account_fingerprint_idx").on(table.accountId, table.fingerprint),
    index("import_row_import_id_idx").on(table.importId),
    index("import_row_transaction_id_idx").on(table.transactionId),
  ],
);

export const importTables = { importBatch, importRow };
