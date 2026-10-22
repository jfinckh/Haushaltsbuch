import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { FieldCrypto } from "@/shared/field-crypto";
import { formatIban } from "@/shared/iban";
import { withSession, type Caller, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import { isCategoryFor, spendingByGroup, type GroupSpending } from "./categories";
import type { ClassifiedBy, TransactionKind } from "./kinds";
import { isMonth, monthOf, monthRange, shiftMonth, today as localToday } from "./months";
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
  /** Who set kind and category: the import or matching (auto), a rule, or a person (manual). */
  classifiedBy: ClassifiedBy;
};

/** Which bookings findBookings returns; all given criteria must hold. */
export type FindBookingsCriteria = {
  ids?: string[];
  accountId?: string;
  amountCents?: number;
  /** Booking dates, YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
  /** Only expenses and income without category that nobody classified by hand. */
  uncategorized?: boolean;
};

/** What a rule sets on a booking. */
export type Classification = { id: string; kind: TransactionKind; category: string | null };

export type ListTransactionsResult =
  | { ok: true; transactions: TransactionView[] }
  | { ok: false; reason: "invalid-input" | "not-found" };

/** Income, expenses and saving of one calendar month (cents, signed as booked), and what is available. */
export type MonthSummary = { month: string; incomeCents: number; expenseCents: number; savingCents: number; availableCents: number };

export type MonthSummaryResult = ({ ok: true } & MonthSummary) | { ok: false; reason: "invalid-input" | "not-found" };

export type MonthSummariesResult = { ok: true; months: MonthSummary[] } | { ok: false; reason: "invalid-input" | "not-found" };

/** The longest series of months monthSummaries computes at once. */
const MAX_MONTHS = 24;

export type CategorySpendingResult =
  | { ok: true; month: string; totalCents: number; groups: GroupSpending[] }
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

/** One visible account, or all of the caller's own private accounts together (dashboard). */
type AccountTarget = string | { ownPrivate: true };

/**
 * The caller's own private accounts (accounts' database contract: a private account has no household
 * and is visible to its owner only), never shared ones.
 */
const ownPrivate: SQL = sql`${transaction.accountId} IN (SELECT account_id FROM accounts_visible_account_scopes() WHERE household_id IS NULL)`;

/** The bookings condition for a target, or null if it is a single account the caller cannot see. */
async function targetFilter(tx: RlsTransaction, target: AccountTarget): Promise<SQL | null> {
  if (typeof target !== "string") return ownPrivate;
  return (await accountIsVisible(tx, target)) ? eq(transaction.accountId, target) : null;
}

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
      classifiedBy: row.classifiedBy,
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

  /** The month series behind monthSummary and monthSummaries (documented on the latter). */
  async function monthSummaries(
    caller: Caller,
    target: AccountTarget,
    count: number,
    until: string = monthOf(today()),
  ): Promise<MonthSummariesResult> {
    if (!isMonth(until) || !Number.isInteger(count) || count < 1 || count > MAX_MONTHS) return { ok: false, reason: "invalid-input" };
    const months = Array.from({ length: count }, (_, i) => shiftMonth(until, -i));
    const from = monthRange(months[count - 1]).from;
    const to = monthRange(until).to;
    return withSession(db, caller, async (tx): Promise<MonthSummariesResult> => {
      const accounts = await targetFilter(tx, target);
      if (!accounts) return { ok: false, reason: "not-found" };
      const month = sql<string>`to_char(${transaction.bookingDate}, 'YYYY-MM')`;
      const rows = await tx
        .select({ month, kind: transaction.kind, sum: sql<string>`sum(${transaction.amountCents})` })
        .from(transaction)
        .where(
          and(
            visible,
            accounts,
            inArray(transaction.kind, ["income", "expense", "saving"]),
            gte(transaction.bookingDate, from),
            lte(transaction.bookingDate, to),
          ),
        )
        .groupBy(month, transaction.kind);
      const sumOf = (m: string, kind: TransactionKind) => Number(rows.find((row) => row.month === m && row.kind === kind)?.sum ?? 0);
      return {
        ok: true,
        months: months.map((m) => {
          const [incomeCents, expenseCents, savingCents] = [sumOf(m, "income"), sumOf(m, "expense"), sumOf(m, "saving")];
          return { month: m, incomeCents, expenseCents, savingCents, availableCents: incomeCents + expenseCents + savingCents };
        }),
      };
    });
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
          .values({
            ...toColumns(parsed.data),
            id: crypto.randomUUID(),
            createdByUserId: userId,
            // A quick entry without category may still be sorted by a rule.
            classifiedBy: parsed.data.category ? "manual" : "auto",
          })
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
        const classifiedByHand = checked.data.kind !== row.kind || checked.data.category !== row.category;
        const [updated] = await tx
          .update(transaction)
          .set({ ...toColumns(checked.data), updatedAt: new Date(), ...(classifiedByHand ? { classifiedBy: "manual" as const } : {}) })
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

    /**
     * Visible bookings inside a database transaction another part opened with withSession: by ids,
     * and/or by account, exact amount and date range. Oldest first. Row-level security applies.
     */
    async findBookings(tx: RlsTransaction, userId: string, criteria: FindBookingsCriteria): Promise<TransactionView[]> {
      if (criteria.ids?.length === 0) return [];
      const filters = [
        visible,
        criteria.ids && inArray(transaction.id, criteria.ids),
        criteria.accountId && eq(transaction.accountId, criteria.accountId),
        criteria.amountCents !== undefined && eq(transaction.amountCents, criteria.amountCents),
        criteria.from && gte(transaction.bookingDate, criteria.from),
        criteria.to && lte(transaction.bookingDate, criteria.to),
        criteria.uncategorized &&
          and(inArray(transaction.kind, ["expense", "income"]), isNull(transaction.category), ne(transaction.classifiedBy, "manual")),
      ].filter((filter): filter is SQL => Boolean(filter));
      const rows = await tx
        .select()
        .from(transaction)
        .where(and(...filters))
        .orderBy(asc(transaction.bookingDate), asc(transaction.createdAt));
      return rows.map((row) => toView(row, userId));
    },

    /**
     * Sets the type of the visible bookings among `ids` inside a given database transaction; a
     * category that does not fit the new type is cleared. Only for decisions made by a person
     * (transfers' manual actions), so the bookings count as classified by hand. Returns how many changed.
     */
    async setKind(tx: RlsTransaction, ids: string[], kind: TransactionKind): Promise<number> {
      if (ids.length === 0) return 0;
      const rows = await tx
        .select({ id: transaction.id, category: transaction.category })
        .from(transaction)
        .where(and(inArray(transaction.id, ids), visible));
      for (const row of rows) {
        const category = row.category && isCategoryFor(kind, row.category) ? row.category : null;
        await tx
          .update(transaction)
          .set({ kind, category, classifiedBy: "manual", updatedAt: new Date() })
          .where(and(eq(transaction.id, row.id), visible));
      }
      return rows.length;
    },

    /**
     * Sets type and category as a rule decided, inside a given database transaction: only visible
     * bookings that nobody classified by hand; they are marked as classified by rule. A category
     * that does not fit its type throws. Returns the ids that changed.
     */
    async classifyBookings(tx: RlsTransaction, items: Classification[]): Promise<string[]> {
      const changed: string[] = [];
      for (const { id, kind, category } of items) {
        if (category !== null && !isCategoryFor(kind, category)) throw new Error("Category does not fit the type");
        const rows = await tx
          .update(transaction)
          .set({ kind, category, classifiedBy: "rule", updatedAt: new Date() })
          .where(and(eq(transaction.id, id), visible, ne(transaction.classifiedBy, "manual")))
          .returning({ id: transaction.id });
        changed.push(...rows.map((row) => row.id));
      }
      return changed;
    },

    /**
     * Net sum (cents) of a visible account's expenses per category key in a calendar month, inside a
     * given database transaction (budgets). Negative means money spent; refunds booked as positive
     * expenses lower it. Expenses without category, income, transfers and saving are left out. Without
     * a month, the current one. An account the caller cannot see gives no totals.
     */
    async expenseTotals(tx: RlsTransaction, accountId: string, month = monthOf(today())): Promise<{ month: string; totals: Record<string, number> }> {
      const { from, to } = monthRange(month);
      const rows = await tx
        .select({ category: transaction.category, sum: sql<string>`sum(${transaction.amountCents})` })
        .from(transaction)
        .where(
          and(
            visible,
            eq(transaction.accountId, accountId),
            eq(transaction.kind, "expense"),
            isNotNull(transaction.category),
            gte(transaction.bookingDate, from),
            lte(transaction.bookingDate, to),
          ),
        )
        .groupBy(transaction.category);
      return { month, totals: Object.fromEntries(rows.map((row) => [row.category!, Number(row.sum)])) };
    },

    /**
     * Income, expenses and saving of a visible account in a calendar month (cents, signed as booked:
     * money out is negative), and what is available: their sum, i.e. income − expenses − saving.
     * Refunds lower the expenses; transfers never count. Without a month, the current one. With
     * `{ ownPrivate: true }`, over all of the caller's own private accounts together.
     */
    async monthSummary(caller: Caller, target: AccountTarget, month: string = monthOf(today())): Promise<MonthSummaryResult> {
      const result = await monthSummaries(caller, target, 1, month);
      return result.ok ? { ok: true, ...result.months[0] } : result;
    },

    /**
     * The month summaries (as monthSummary) of `count` (1–24) calendar months ending with `until`
     * (default: the current month), newest first; a month without bookings gives zeros.
     */
    monthSummaries,

    /**
     * What a visible account spent in a calendar month per category group (positive cents), largest
     * first; `group: null` is expenses without category. Only expenses count; refunds lower their
     * group, and a group at zero or below is left out. Without a month, the current one. With
     * `{ ownPrivate: true }`, over all of the caller's own private accounts together.
     */
    async categorySpending(caller: Caller, target: AccountTarget, month: string = monthOf(today())): Promise<CategorySpendingResult> {
      if (!isMonth(month)) return { ok: false, reason: "invalid-input" };
      const { from, to } = monthRange(month);
      return withSession(db, caller, async (tx): Promise<CategorySpendingResult> => {
        const accounts = await targetFilter(tx, target);
        if (!accounts) return { ok: false, reason: "not-found" };
        const rows = await tx
          .select({ category: transaction.category, sum: sql<string>`sum(${transaction.amountCents})` })
          .from(transaction)
          .where(
            and(
              visible,
              accounts,
              eq(transaction.kind, "expense"),
              gte(transaction.bookingDate, from),
              lte(transaction.bookingDate, to),
            ),
          )
          .groupBy(transaction.category);
        return { ok: true, month, ...spendingByGroup(rows.map((row) => ({ category: row.category, sumCents: Number(row.sum) }))) };
      });
    },

    /**
     * The newest bookings of a visible account, any month, at most `limit` (1–50). With
     * `{ ownPrivate: true }`, of all of the caller's own private accounts together.
     */
    async latestTransactions(caller: Caller, target: AccountTarget, limit: number): Promise<ListTransactionsResult> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) return { ok: false, reason: "invalid-input" };
      return withSession(db, caller, async (tx, userId): Promise<ListTransactionsResult> => {
        const accounts = await targetFilter(tx, target);
        if (!accounts) return { ok: false, reason: "not-found" };
        const rows = await tx
          .select()
          .from(transaction)
          .where(and(accounts, visible))
          .orderBy(desc(transaction.bookingDate), desc(transaction.createdAt))
          .limit(limit);
        return { ok: true, transactions: rows.map((row) => toView(row, userId)) };
      });
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
