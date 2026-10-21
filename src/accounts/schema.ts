import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Table of the accounts part. A private account belongs to its owner only (no household); a shared
// account belongs to a household. User and household ids are plain text without foreign keys in
// this file, so the part stays independent of auth and households. The foreign key to household
// (cascade on delete), the grants and row-level security are set up in drizzle/0009_accounts_rls.sql.

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    // Set exactly when the account is shared.
    householdId: text("household_id"),
    visibility: text("visibility", { enum: ["private", "shared"] }).notNull(),
    name: text("name").notNull(),
    bank: text("bank", { enum: ["ing", "trade_republic", "cash", "other"] }).notNull(),
    type: text("type", { enum: ["checking", "savings", "clearing", "depot", "cash"] }).notNull(),
    role: text("role", { enum: ["everyday", "savings"] }).notNull(),
    openingBalanceCents: bigint("opening_balance_cents", { mode: "number" }).notNull().default(0),
    // AES-GCM ciphertext with key version (shared/field-crypto) and its HMAC blind index.
    ibanEncrypted: text("iban_encrypted"),
    ibanIndex: text("iban_index"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("account_owner_user_id_idx").on(table.ownerUserId),
    index("account_household_id_idx").on(table.householdId),
    index("account_iban_index_idx").on(table.ibanIndex),
    check("account_visibility_check", sql`${table.visibility} IN ('private', 'shared')`),
    check("account_household_check", sql`(${table.visibility} = 'shared') = (${table.householdId} IS NOT NULL)`),
    check("account_bank_check", sql`${table.bank} IN ('ing', 'trade_republic', 'cash', 'other')`),
    check("account_type_check", sql`${table.type} IN ('checking', 'savings', 'clearing', 'depot', 'cash')`),
    check("account_role_check", sql`${table.role} IN ('everyday', 'savings')`),
    check("account_cash_check", sql`(${table.bank} = 'cash') = (${table.type} = 'cash')`),
    check("account_iban_pair_check", sql`(${table.ibanEncrypted} IS NULL) = (${table.ibanIndex} IS NULL)`),
    check("account_cash_iban_check", sql`${table.bank} <> 'cash' OR ${table.ibanEncrypted} IS NULL`),
  ],
);

export const accountTables = { account };
