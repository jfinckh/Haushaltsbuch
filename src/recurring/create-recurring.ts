import { asc, eq, sql } from "drizzle-orm";
import { rows, withSession, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import type { BookingStore } from "@/transactions/server";
import type { CreateWithBookingResult, Recurring, TemplateStatus, TemplateView } from "./contract";
import { recurringOccurrence, recurringTemplate } from "./schema";
import { repeatSchema, templateActionSchema, type IntervalMonths } from "./validation";

export type RecurringOptions = {
  db: RlsDatabase;
  /** Creates the first booking and encrypts the template's texts exactly like a booking's. */
  transactions: Pick<BookingStore, "createBooking" | "encodeTexts" | "decodeTexts">;
  /** Today (YYYY-MM-DD) for resume and end. Default: today in Germany. */
  today?: () => string;
};

type TemplateRow = typeof recurringTemplate.$inferSelect;

const berlinDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

/** Today's date in Germany (YYYY-MM-DD), the time zone the hourly run uses. */
export function todayInGermany(): string {
  return berlinDate.format(new Date());
}

/** The first date of the series on or after `from` (SQL recurring_due_after, drizzle/0029). */
async function dueAfter(tx: RlsTransaction, day: number, interval: number, anchor: string, from: string): Promise<string> {
  const [row] = await rows<{ due: string }>(
    tx,
    sql`SELECT recurring_due_after(${day}::int, ${interval}::int, ${anchor}::date, ${from}::date)::text AS due`,
  );
  return row.due;
}

/** The later of two YYYY-MM-DD dates. */
const later = (a: string, b: string) => (a > b ? a : b);

const dayAfter = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * The recurring part for pages and routes. Every call runs in the caller's session; row-level
 * security shows a template to whoever may see its account (drizzle/0029_recurring_functions.sql).
 */
export function createRecurring({ db, transactions, today = todayInGermany }: RecurringOptions): Recurring {
  function statusOf(row: TemplateRow, archived: ReadonlySet<string>): TemplateStatus {
    if (archived.has(row.accountId)) return "archived";
    if (row.endDate !== null && row.endDate < row.nextDueDate) return "ended";
    return row.paused ? "paused" : "active";
  }

  function toView(row: TemplateRow, userId: string, archived: ReadonlySet<string> = new Set()): TemplateView {
    return {
      id: row.id,
      accountId: row.accountId,
      amountCents: row.amountCents,
      kind: row.kind,
      category: row.category,
      ...transactions.decodeTexts(row),
      intervalMonths: row.intervalMonths as IntervalMonths,
      dayOfMonth: row.dayOfMonth,
      nextDueDate: row.nextDueDate,
      endDate: row.endDate,
      status: statusOf(row, archived),
      createdByMe: row.createdByUserId === userId,
    };
  }

  return {
    async createWithBooking(caller, input): Promise<CreateWithBookingResult> {
      if (!input || typeof input !== "object") return { ok: false, reason: "invalid-input" };
      const { repeat, ...bookingInput } = input as Record<string, unknown>;
      const parsed = repeatSchema.safeParse(repeat);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const { intervalMonths, endDate } = parsed.data;

      return withSession(db, caller, async (tx, userId): Promise<CreateWithBookingResult> => {
        const created = await transactions.createBooking(tx, userId, bookingInput);
        if (!created.ok) return created;
        const booking = created.transaction;
        // An end before the first date: undo the booking (throwing rolls the transaction back).
        if (endDate !== null && endDate < booking.date) throw new EndBeforeStartError();
        const day = Number(booking.date.slice(8, 10));
        const templateId = crypto.randomUUID();
        await tx.insert(recurringTemplate).values({
          id: templateId,
          accountId: booking.accountId,
          amountCents: booking.amountCents,
          kind: booking.kind,
          category: booking.category,
          ...transactions.encodeTexts(booking),
          countsNextMonth: booking.countsNextMonth,
          classifiedBy: booking.classifiedBy === "manual" ? "manual" : "auto",
          intervalMonths,
          dayOfMonth: day,
          nextDueDate: await dueAfter(tx, day, intervalMonths, booking.date, dayAfter(booking.date)),
          endDate,
          createdByUserId: userId,
        });
        // The booking is the first date, so the hourly run never books it again.
        await tx.insert(recurringOccurrence).values({ templateId, dueDate: booking.date, transactionId: booking.id });
        return { ok: true, transaction: booking, templateId };
      }).catch((error: unknown) => {
        if (error instanceof EndBeforeStartError) return { ok: false, reason: "invalid-input" } as const;
        throw error;
      });
    },

    async listTemplates(caller, { archivedAccountIds = new Set<string>() } = {}) {
      return withSession(db, caller, async (tx, userId) => {
        const found = await tx.select().from(recurringTemplate).orderBy(asc(recurringTemplate.nextDueDate), asc(recurringTemplate.id));
        return found.map((row) => toView(row, userId, archivedAccountIds));
      });
    },

    async act(caller, id, input) {
      const parsed = templateActionSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const { action } = parsed.data;
      return withSession(db, caller, async (tx, userId) => {
        const [row] = await tx.select().from(recurringTemplate).where(eq(recurringTemplate.id, id));
        if (!row) return { ok: false, reason: "not-found" } as const;
        const now = today();
        const changes =
          action === "pause"
            ? { paused: true }
            : action === "end"
              ? // An earlier end stays: ending again must not bring an ended template back.
                { endDate: row.endDate !== null && row.endDate < now ? row.endDate : now }
              : row.paused
                ? {
                    paused: false,
                    // The pause is not caught up: the first date on or after today, never earlier than planned.
                    nextDueDate: later(row.nextDueDate, await dueAfter(tx, row.dayOfMonth, row.intervalMonths, row.nextDueDate, now)),
                  }
                : {}; // Not paused: nothing to resume, dates still due stay due.
        const [updated] = await tx
          .update(recurringTemplate)
          .set({ ...changes, updatedAt: new Date() })
          .where(eq(recurringTemplate.id, id))
          .returning();
        return { ok: true, template: toView(updated, userId) } as const;
      });
    },

    async deleteTemplate(caller, id) {
      return withSession(db, caller, async (tx) => {
        const deleted = await tx.delete(recurringTemplate).where(eq(recurringTemplate.id, id)).returning({ id: recurringTemplate.id });
        return deleted.length > 0;
      });
    },
  };
}

/** Thrown inside the transaction to undo the booking when the end lies before it. */
class EndBeforeStartError extends Error {
  constructor() {
    super("End date before the first booking");
    this.name = "EndBeforeStartError";
  }
}
