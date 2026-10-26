import { and, desc, eq, gte, inArray, isNull, like, lte, or, type SQL } from "drizzle-orm";
import { withSession, type RlsDatabase } from "@/shared/rls";
import { accountIsVisible, categoryAllowed, findVisible, notOnSavingsAccount, ownPrivate, targetFilter, visible } from "./access";
import type { BookingCodec } from "./booking-codec";
import { isCategoryFor } from "./categories";
import type { BookingService, LatestTransactionsResult, ListTransactionsResult, SaveTransactionResult } from "./contract";
import { monthOf, monthRange } from "./months";
import { transaction } from "./schema";
import { createTransactionSchema, listQuerySchema, transactionValuesSchema, updateTransactionSchema } from "./validation";

export type BookingServiceDeps = {
  db: RlsDatabase;
  codec: BookingCodec;
  /** Today's date (YYYY-MM-DD) for the default month. */
  today: () => string;
};

/** Bookings for pages and routes (documented on BookingService). */
export function createBookingService({ db, codec, today }: BookingServiceDeps): BookingService {
  const { toView, toValues, toColumns } = codec;

  return {
    async listTransactions(caller, query): Promise<ListTransactionsResult> {
      const parsed = listQuerySchema.safeParse(query);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const { accountId, scope, kind, category, q, limit } = parsed.data;
      const { from, to } = parsed.data.month
        ? monthRange(parsed.data.month)
        : parsed.data.year
          ? { from: `${parsed.data.year}-01-01`, to: `${parsed.data.year}-12-31` }
          : parsed.data.from || parsed.data.to
            ? { from: parsed.data.from, to: parsed.data.to }
            : monthRange(monthOf(today()));

      return withSession(db, caller, async (tx, userId): Promise<ListTransactionsResult> => {
        let target: SQL;
        if (scope) {
          target = ownPrivate;
        } else {
          const id = accountId as string;
          if (!(await accountIsVisible(tx, id))) return { ok: false, reason: "not-found" };
          target = eq(transaction.accountId, id);
        }
        const filters = [
          target,
          visible,
          scope && kind === "saving" && notOnSavingsAccount,
          from && gte(transaction.bookingDate, from),
          to && lte(transaction.bookingDate, to),
          kind && eq(transaction.kind, kind),
          category === "none"
            ? and(isNull(transaction.category), inArray(transaction.kind, ["expense", "income"]))
            : category && or(eq(transaction.category, category), like(transaction.category, `${category}.%`)),
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
        const total = { count: views.length, sumCents: views.reduce((sum, view) => sum + view.amountCents, 0) };
        return { ok: true, transactions: limit ? views.slice(0, limit) : views, total };
      });
    },

    async getTransaction(caller, id) {
      return withSession(db, caller, async (tx, userId) => {
        const row = await findVisible(tx, id);
        return row && toView(row, userId);
      });
    },

    async createTransaction(caller, input): Promise<SaveTransactionResult> {
      const parsed = createTransactionSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      return withSession(db, caller, async (tx, userId): Promise<SaveTransactionResult> => {
        if (!(await accountIsVisible(tx, parsed.data.accountId))) return { ok: false, reason: "not-found" };
        const { accountId, kind, category: key } = parsed.data;
        if (key !== null && !(await categoryAllowed(tx, accountId, kind, key))) return { ok: false, reason: "invalid-input" };
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

    async updateTransaction(caller, id, input): Promise<SaveTransactionResult> {
      const parsed = updateTransactionSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const changes = parsed.data;

      return withSession(db, caller, async (tx, userId): Promise<SaveTransactionResult> => {
        const row = await findVisible(tx, id, true);
        if (!row) return { ok: false, reason: "not-found" };
        const merged = { ...toValues(row), ...changes };
        // A new type drops a category that does not fit it (own categories have a fixed type).
        if (changes.kind && changes.kind !== row.kind && changes.category === undefined && merged.category && !isCategoryFor(merged.kind, merged.category)) {
          merged.category = null;
        }
        const checked = transactionValuesSchema.safeParse(merged);
        if (!checked.success) return { ok: false, reason: "invalid-input" };
        if (checked.data.accountId !== row.accountId && !(await accountIsVisible(tx, checked.data.accountId))) {
          return { ok: false, reason: "not-found" };
        }
        // A set or changed category, or a move to another account, is checked again; an unchanged
        // category may stay even when it was archived in the meantime.
        const { accountId, kind, category: key } = checked.data;
        const unchanged = key === row.category;
        if (key !== null && (!unchanged || accountId !== row.accountId || kind !== row.kind)) {
          if (!(await categoryAllowed(tx, accountId, kind, key, { allowArchived: unchanged }))) return { ok: false, reason: "invalid-input" };
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

    async deleteTransaction(caller, id) {
      return withSession(db, caller, async (tx) => {
        const deleted = await tx
          .delete(transaction)
          .where(and(eq(transaction.id, id), visible))
          .returning({ id: transaction.id });
        return deleted.length > 0;
      });
    },

    async latestTransactions(caller, target, limit): Promise<LatestTransactionsResult> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) return { ok: false, reason: "invalid-input" };
      return withSession(db, caller, async (tx, userId): Promise<LatestTransactionsResult> => {
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
  };
}
