import { and, desc, eq, gte, inArray, like, lte, or, sql, type SQL } from "drizzle-orm";
import type { FieldCrypto } from "@/shared/field-crypto";
import { formatIban } from "@/shared/iban";
import { withSession, type Caller, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import { isCategoryFor } from "./categories";
import type { TransactionKind } from "./kinds";
import { monthOf, monthRange, today as localToday } from "./months";
import { transaction } from "./schema";
import {
  createTransactionSchema,
  listQuerySchema,
  transactionValuesSchema,
  updateTransactionSchema,
  type TransactionValues,
} from "./validation";

export type TransactionsOptions = {
  db: RlsDatabase;
  /** Encrypts counterparty, IBAN and reference; keys come from the environment. */
  crypto: FieldCrypto;
  /** Today's date (YYYY-MM-DD) for the default month. Default: the local date. */
  today?: () => string;
};

/** A booking as callers see it. The creator's user id is never sent. */
export type TransactionView = {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  kind: TransactionKind;
  category: string | null;
  counterparty: string | null;
  /** Formatted in groups of four, or null. */
  counterpartyIban: string | null;
  reference: string | null;
  createdByMe: boolean;
};

export type ListTransactionsResult =
  | { ok: true; transactions: TransactionView[] }
  | { ok: false; reason: "invalid-input" | "not-found" };

export type SaveTransactionResult =
  | { ok: true; transaction: TransactionView }
  | { ok: false; reason: "invalid-input" | "not-found" };

const CONTEXT = {
  counterparty: "transaction.counterparty",
  counterpartyIban: "transaction.counterpartyIban",
  reference: "transaction.reference",
} as const;

type TransactionRow = typeof transaction.$inferSelect;

/** Bookings of accounts the session's user may see (accounts' database contract). RLS applies the same rule. */
const visible: SQL = sql`${transaction.accountId} IN (SELECT accounts_visible_account_ids())`;

async function accountIsVisible(tx: RlsTransaction, accountId: string): Promise<boolean> {
  const result = (await tx.execute(
    sql`SELECT 1 AS found WHERE ${accountId} IN (SELECT accounts_visible_account_ids())`,
  )) as unknown as { rows: unknown[] };
  return result.rows.length > 0;
}

/** The transactions part. Every call is about the caller's own view; their user id comes from the database. */
export function createTransactions({ db, crypto: fieldCrypto, today = localToday }: TransactionsOptions) {
  const decrypt = (value: string | null, context: string) => (value === null ? null : fieldCrypto.decrypt(value, context));
  const encrypt = (value: string | null, context: string) => (value === null ? null : fieldCrypto.encrypt(value, context));

  function toView(row: TransactionRow, userId: string): TransactionView {
    const iban = decrypt(row.counterpartyIbanEncrypted, CONTEXT.counterpartyIban);
    return {
      id: row.id,
      accountId: row.accountId,
      date: row.bookingDate,
      amountCents: row.amountCents,
      kind: row.kind,
      category: row.category,
      counterparty: decrypt(row.counterpartyEncrypted, CONTEXT.counterparty),
      counterpartyIban: iban && formatIban(iban),
      reference: decrypt(row.referenceEncrypted, CONTEXT.reference),
      createdByMe: row.createdByUserId === userId,
    };
  }

  function toValues(row: TransactionRow): TransactionValues {
    return {
      accountId: row.accountId,
      bookingDate: row.bookingDate,
      amountCents: row.amountCents,
      kind: row.kind,
      category: row.category,
      counterparty: decrypt(row.counterpartyEncrypted, CONTEXT.counterparty),
      counterpartyIban: decrypt(row.counterpartyIbanEncrypted, CONTEXT.counterpartyIban),
      reference: decrypt(row.referenceEncrypted, CONTEXT.reference),
    };
  }

  /** The stored columns for a booking's values, encrypted. */
  function toColumns({ counterparty, counterpartyIban, reference, ...plain }: TransactionValues) {
    return {
      ...plain,
      counterpartyEncrypted: encrypt(counterparty, CONTEXT.counterparty),
      counterpartyIbanEncrypted: encrypt(counterpartyIban, CONTEXT.counterpartyIban),
      counterpartyIbanIndex: counterpartyIban && fieldCrypto.blindIndex(counterpartyIban, CONTEXT.counterpartyIban),
      referenceEncrypted: encrypt(reference, CONTEXT.reference),
    };
  }

  async function findVisible(tx: RlsTransaction, id: string, lock = false) {
    const query = tx
      .select()
      .from(transaction)
      .where(and(eq(transaction.id, id), visible));
    const [row] = lock ? await query.for("update") : await query;
    return row ?? null;
  }

  return {
    /**
     * Bookings of one account, newest first, for a month or from/to; without either, the current
     * calendar month. The search
     * text is matched against counterparty and reference after decryption, so only within the range.
     */
    async listTransactions(caller: Caller, query: unknown): Promise<ListTransactionsResult> {
      const parsed = listQuerySchema.safeParse(query);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const { accountId, kind, category, q } = parsed.data;
      const range = parsed.data.month
        ? monthRange(parsed.data.month)
        : parsed.data.from || parsed.data.to
          ? { from: parsed.data.from, to: parsed.data.to }
          : monthRange(monthOf(today()));
      const { from, to } = range;

      return withSession(db, caller, async (tx, userId): Promise<ListTransactionsResult> => {
        if (!(await accountIsVisible(tx, accountId))) return { ok: false, reason: "not-found" };
        const filters = [
          eq(transaction.accountId, accountId),
          visible,
          from && gte(transaction.bookingDate, from),
          to && lte(transaction.bookingDate, to),
          kind && eq(transaction.kind, kind),
          category && or(eq(transaction.category, category), like(transaction.category, `${category}.%`)),
        ].filter((filter): filter is SQL => Boolean(filter));
        const rows = await tx
          .select()
          .from(transaction)
          .where(and(...filters))
          .orderBy(desc(transaction.bookingDate), desc(transaction.createdAt));
        let views = rows.map((row) => toView(row, userId));
        if (q) {
          const needle = q.toLocaleLowerCase("de");
          views = views.filter((view) =>
            [view.counterparty, view.reference].some((text) => text?.toLocaleLowerCase("de").includes(needle)),
          );
        }
        return { ok: true, transactions: views };
      });
    },

    /** One booking, or null if it does not exist or the caller may not see its account. */
    async getTransaction(caller: Caller, id: string): Promise<TransactionView | null> {
      return withSession(db, caller, async (tx, userId) => {
        const row = await findVisible(tx, id);
        return row && toView(row, userId);
      });
    },

    /** Adds a booking to an account the caller may see; the caller is recorded as its creator. */
    async createTransaction(caller: Caller, input: unknown): Promise<SaveTransactionResult> {
      const parsed = createTransactionSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      return withSession(db, caller, async (tx, userId): Promise<SaveTransactionResult> => {
        if (!(await accountIsVisible(tx, parsed.data.accountId))) return { ok: false, reason: "not-found" };
        const [row] = await tx
          .insert(transaction)
          .values({ ...toColumns(parsed.data), id: crypto.randomUUID(), createdByUserId: userId })
          .returning();
        return { ok: true, transaction: toView(row, userId) };
      });
    },

    /**
     * Changes a visible booking; omitted fields stay. Moving it needs the new account to be visible.
     * A category that no longer fits a new type is dropped.
     */
    async updateTransaction(caller: Caller, id: string, input: unknown): Promise<SaveTransactionResult> {
      const parsed = updateTransactionSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const changes = parsed.data;

      return withSession(db, caller, async (tx, userId): Promise<SaveTransactionResult> => {
        const row = await findVisible(tx, id, true);
        if (!row) return { ok: false, reason: "not-found" };
        const merged = { ...toValues(row), ...changes };
        if (changes.kind && changes.category === undefined && merged.category && !isCategoryFor(merged.kind, merged.category)) {
          merged.category = null;
        }
        const checked = transactionValuesSchema.safeParse(merged);
        if (!checked.success) return { ok: false, reason: "invalid-input" };
        if (checked.data.accountId !== row.accountId && !(await accountIsVisible(tx, checked.data.accountId))) {
          return { ok: false, reason: "not-found" };
        }
        const [updated] = await tx
          .update(transaction)
          .set({ ...toColumns(checked.data), updatedAt: new Date() })
          .where(and(eq(transaction.id, id), visible))
          .returning();
        return { ok: true, transaction: toView(updated, userId) };
      });
    },

    /** Deletes a visible booking; false if there is none the caller may see. */
    async deleteTransaction(caller: Caller, id: string): Promise<boolean> {
      return withSession(db, caller, async (tx) => {
        const deleted = await tx
          .delete(transaction)
          .where(and(eq(transaction.id, id), visible))
          .returning({ id: transaction.id });
        return deleted.length > 0;
      });
    },

    /**
     * Adds bookings inside a database transaction another part opened with withSession (the import
     * writes bookings and its fingerprints together). Each booking is checked; invalid values throw.
     * Row-level security applies: only visible accounts, created by `userId` (the session's user).
     */
    async insertBookings(tx: RlsTransaction, userId: string, values: TransactionValues[]): Promise<string[]> {
      if (values.length === 0) return [];
      const rows = values.map((value) => ({
        ...toColumns(transactionValuesSchema.parse(value)),
        id: crypto.randomUUID(),
        createdByUserId: userId,
      }));
      const inserted = await tx.insert(transaction).values(rows).returning({ id: transaction.id });
      return inserted.map((row) => row.id);
    },

    /** Deletes the visible bookings among `ids` inside a given database transaction; returns how many. */
    async deleteBookings(tx: RlsTransaction, ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;
      const deleted = await tx
        .delete(transaction)
        .where(and(inArray(transaction.id, ids), visible))
        .returning({ id: transaction.id });
      return deleted.length;
    },

    /** Sum of the bookings per visible account that has any (cents). The app adds the opening balance. */
    async balances(caller: Caller): Promise<Record<string, number>> {
      return withSession(db, caller, async (tx) => {
        const rows = await tx
          .select({ accountId: transaction.accountId, sum: sql<string>`sum(${transaction.amountCents})` })
          .from(transaction)
          .where(visible)
          .groupBy(transaction.accountId);
        return Object.fromEntries(rows.map((row) => [row.accountId, Number(row.sum)]));
      });
    },
  };
}

export type Transactions = ReturnType<typeof createTransactions>;
