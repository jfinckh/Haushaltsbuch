import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Tables of the transfers part. Booking and account ids are plain text in this file, so the part
// stays independent of accounts and transactions; the foreign keys (cascade on delete), the grants,
// row-level security and the database functions are set up in drizzle/0016_transfers_functions.sql.

/**
 * Two bookings that form a transfer (linked), may form one (proposed), or must never be linked
 * automatically again (rejected). The app's database role has no access to this table at all: it
 * goes through the transfers_* database functions, which give each member only their own side.
 */
export const transferPair = pgTable(
  "transfer_pair",
  {
    id: text("id").primaryKey(),
    // The −X booking and the +X booking.
    outgoingTransactionId: text("outgoing_transaction_id").notNull(),
    incomingTransactionId: text("incoming_transaction_id").notNull(),
    status: text("status", { enum: ["linked", "proposed", "rejected"] }).notNull(),
    // Decided by a person (link, accept, reject, unlink); automatic matching never changes these.
    manual: boolean("manual").notNull().default(false),
    decidedByUserId: text("decided_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("transfer_pair_bookings_idx").on(table.outgoingTransactionId, table.incomingTransactionId),
    uniqueIndex("transfer_pair_linked_outgoing_idx").on(table.outgoingTransactionId).where(sql`status = 'linked'`),
    uniqueIndex("transfer_pair_linked_incoming_idx").on(table.incomingTransactionId).where(sql`status = 'linked'`),
    index("transfer_pair_incoming_idx").on(table.incomingTransactionId),
    check("transfer_pair_status_check", sql`${table.status} IN ('linked', 'proposed', 'rejected')`),
    check("transfer_pair_sides_check", sql`${table.outgoingTransactionId} <> ${table.incomingTransactionId}`),
  ],
);

/**
 * Transfer facts of one booking: the hints found when it was imported (never as text: a blind index,
 * a bank key, a member's user id) and the manual decisions. Visible to whoever may see its booking.
 */
export const transferBooking = pgTable(
  "transfer_booking",
  {
    transactionId: text("transaction_id").primaryKey(),
    // Blind index (context account.iban, the accounts' IBAN index) of the counterparty IBAN or an IBAN in the text.
    mentionedIbanIndex: text("mentioned_iban_index"),
    // The bank the text names, e.g. trade_republic.
    mentionedBank: text("mentioned_bank"),
    // The household member whose name is the counterparty.
    counterpartyMemberId: text("counterparty_member_id"),
    // An open transfer while it has no linked pair and no decision that rules a partner out.
    expectsPartner: boolean("expects_partner").notNull().default(false),
    // kind: the type was set by hand (decided_kind); no-partner: a transfer without counter-booking.
    decision: text("decision", { enum: ["kind", "no-partner"] }),
    decidedKind: text("decided_kind", { enum: ["expense", "income", "transfer", "saving"] }),
    // For no-partner: an external own account, or an account in the app (target_account_id).
    target: text("target", { enum: ["external", "account"] }),
    targetAccountId: text("target_account_id"),
    decidedByUserId: text("decided_by_user_id"),
    // A rule said: transfer from or to an external own account. Not open, but unlike a manual
    // no-partner decision it does not block matching: a later counter-booking is still linked.
    ruleTarget: text("rule_target", { enum: ["external"] }),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("transfer_booking_iban_idx").on(table.mentionedIbanIndex),
    check("transfer_booking_decision_check", sql`${table.decision} IS NULL OR ${table.decision} IN ('kind', 'no-partner')`),
    check("transfer_booking_kind_check", sql`(${table.decision} = 'kind') = (${table.decidedKind} IS NOT NULL)`),
    check("transfer_booking_rule_target_check", sql`${table.ruleTarget} IS NULL OR ${table.ruleTarget} = 'external'`),
    check("transfer_booking_target_check", sql`(${table.decision} = 'no-partner') = (${table.target} IS NOT NULL)`),
  ],
);

export const transferTables = { transferPair, transferBooking };
