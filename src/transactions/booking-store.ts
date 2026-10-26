import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { categoryAllowed, findVisible, visible } from "./access";
import type { BookingCodec } from "./booking-codec";
import { isCategoryFor, ownCategoryId } from "./categories";
import type { BookingStore } from "./contract";
import { monthOf, monthRange } from "./months";
import { transaction } from "./schema";
import { transactionValuesSchema } from "./validation";

export type BookingStoreDeps = {
  codec: BookingCodec;
  /** Today's date (YYYY-MM-DD) for the default month. */
  today: () => string;
};

/** Booking methods for other parts inside their database transaction (documented on BookingStore). */
export function createBookingStore({ codec, today }: BookingStoreDeps): BookingStore {
  const { toView, toValues, toColumns } = codec;

  return {
    async insertBookings(tx, userId, values) {
      if (values.length === 0) return [];
      const rows = values.map((value) => ({
        ...toColumns(transactionValuesSchema.parse(value)),
        id: crypto.randomUUID(),
        createdByUserId: userId,
      }));
      const inserted = await tx.insert(transaction).values(rows).returning({ id: transaction.id });
      return inserted.map((row) => row.id);
    },

    async hasBookings(tx, accountId) {
      const [row] = await tx
        .select({ id: transaction.id })
        .from(transaction)
        .where(and(eq(transaction.accountId, accountId), visible))
        .limit(1);
      return Boolean(row);
    },

    async deleteBookings(tx, ids) {
      if (ids.length === 0) return 0;
      const deleted = await tx
        .delete(transaction)
        .where(and(inArray(transaction.id, ids), visible))
        .returning({ id: transaction.id });
      return deleted.length;
    },

    async findBookings(tx, userId, criteria) {
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

    async checkCategory(tx, target, kind, key, options = {}) {
      return categoryAllowed(tx, target, kind, key, options);
    },

    async setKind(tx, ids, kind) {
      if (ids.length === 0) return 0;
      const rows = await tx
        .select({ id: transaction.id, kind: transaction.kind, category: transaction.category })
        .from(transaction)
        .where(and(inArray(transaction.id, ids), visible));
      for (const row of rows) {
        const category = row.category && (row.kind === kind || isCategoryFor(kind, row.category)) ? row.category : null;
        await tx
          .update(transaction)
          .set({ kind, category, classifiedBy: "manual", updatedAt: new Date() })
          .where(and(eq(transaction.id, row.id), visible));
      }
      return rows.length;
    },

    async mergeImported(tx, id, details) {
      const row = await findVisible(tx, id, true);
      if (!row) return null;
      const before = toValues(row);
      const merged = transactionValuesSchema.parse({ ...before, ...details });
      await tx
        .update(transaction)
        .set({ ...toColumns(merged), updatedAt: new Date() })
        .where(and(eq(transaction.id, id), visible));
      const { bookingDate, counterparty, counterpartyIban, reference, kind, category } = before;
      return { bookingDate, counterparty, counterpartyIban, reference, kind, category, classifiedBy: row.classifiedBy };
    },

    async restoreMerged(tx, id, previous) {
      const row = await findVisible(tx, id, true);
      if (!row) return false;
      const keepClassification = row.classifiedBy === "manual" && previous.classifiedBy !== "manual";
      const { classifiedBy, ...values } = previous;
      const restored = transactionValuesSchema.parse({
        ...toValues(row),
        ...values,
        ...(keepClassification ? { kind: row.kind, category: row.category } : {}),
      });
      await tx
        .update(transaction)
        .set({ ...toColumns(restored), ...(keepClassification ? {} : { classifiedBy }), updatedAt: new Date() })
        .where(and(eq(transaction.id, id), visible));
      return true;
    },

    async classifyBookings(tx, items) {
      const changed: string[] = [];
      for (const { id, kind, category } of items) {
        if (category !== null && ownCategoryId(category)) {
          // An own category only where it fits the booking's account; archived ones still apply
          // (the rule existed before). Otherwise the booking stays as it is.
          const [booking] = await tx.select({ accountId: transaction.accountId }).from(transaction).where(and(eq(transaction.id, id), visible));
          if (!booking || !(await categoryAllowed(tx, booking.accountId, kind, category, { allowArchived: true }))) continue;
        } else if (category !== null && !isCategoryFor(kind, category)) {
          throw new Error("Category does not fit the type");
        }
        const rows = await tx
          .update(transaction)
          .set({ kind, category, classifiedBy: "rule", updatedAt: new Date() })
          .where(and(eq(transaction.id, id), visible, ne(transaction.classifiedBy, "manual")))
          .returning({ id: transaction.id });
        changed.push(...rows.map((row) => row.id));
      }
      return changed;
    },

    async expenseTotals(tx, accountId, month = monthOf(today())) {
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
  };
}
