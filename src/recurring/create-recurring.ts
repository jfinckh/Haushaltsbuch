import { asc, eq, inArray, sql } from "drizzle-orm";
import { accountIsVisible } from "@/db-contract/server";
import type { FieldCrypto } from "@/shared/field-crypto";
import { rows, withSession, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import type { BookingStore } from "@/transactions/server";
import type { CreateWithBookingResult, Recurring, TemplateResult, TemplateStatus, TemplateView } from "./contract";
import { recurringOccurrence, recurringSuggestionDismissal, recurringTemplate } from "./schema";
import { findSuggestions, normalizeCounterparty, suggestionWindowStart } from "./suggestions";
import { dismissSuggestionSchema, repeatSchema, templateActionSchema, templateInputSchema, type IntervalMonths, type TemplateValues } from "./validation";

export type RecurringOptions = {
  db: RlsDatabase;
  /** Creates the first booking and encrypts the template's texts exactly like a booking's. */
  transactions: Pick<BookingStore, "createBooking" | "encodeTexts" | "decodeTexts" | "checkCategory" | "findBookings">;
  /**
   * Which bookings an import created or merged into (import's lookup, wired by the app), inside the
   * caller's transaction. Suggestions come only from bookings entered by hand. Default: none.
   */
  importedBookingIds?: (tx: RlsTransaction, bookingIds: readonly string[]) => Promise<ReadonlySet<string>>;
  /** Blind index for hidden suggestions; keys come from the environment. */
  crypto: Pick<FieldCrypto, "blindIndex">;
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

/** Whether `date` is the series date of `day` in its month (the day, or the month's last day). */
function fitsDay(day: number, date: string): boolean {
  const [year, month, dayOfDate] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.min(day, lastDay) === dayOfDate;
}

const dayAfter = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * The recurring part for pages and routes. Every call runs in the caller's session; row-level
 * security shows a template to whoever may see its account (drizzle/0029_recurring_functions.sql).
 */
const SUGGESTION_CONTEXT = "recurring-suggestion.counterparty";

export function createRecurring({
  db,
  transactions,
  crypto: fieldCrypto,
  importedBookingIds = async () => new Set<string>(),
  today = todayInGermany,
}: RecurringOptions): Recurring {
  /** The stored fingerprint of a hidden suggestion's account and counterparty. */
  const dismissalKey = (accountId: string, counterparty: string) => `${accountId}:${fieldCrypto.blindIndex(normalizeCounterparty(counterparty), SUGGESTION_CONTEXT)}`;

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
      countsNextMonth: row.countsNextMonth,
      intervalMonths: row.intervalMonths as IntervalMonths,
      dayOfMonth: row.dayOfMonth,
      nextDueDate: row.nextDueDate,
      endDate: row.endDate,
      status: statusOf(row, archived),
      createdByMe: row.createdByUserId === userId,
    };
  }

  type Checked = { ok: true; values: TemplateValues } | { ok: false; reason: "invalid-input" | "not-found" };

  /**
   * Checks template form input for the caller: valid, next date not before today, a visible account
   * and a category it offers. With the `existing` template, its archived category stays allowed, and
   * a paused template may keep its (past) next date: resume moves it forward anyway.
   */
  async function checkInput(tx: RlsTransaction, input: unknown, existing?: TemplateRow): Promise<Checked> {
    const parsed = templateInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: "invalid-input" };
    const values = parsed.data;
    const keepsPausedDate = existing?.paused === true && values.nextDueDate === existing.nextDueDate;
    if (values.nextDueDate < today() && !keepsPausedDate) return { ok: false, reason: "invalid-input" };
    const unchanged = existing;
    if (!(await accountIsVisible(tx, values.accountId))) return { ok: false, reason: "not-found" };
    if (values.category !== null) {
      const same = unchanged?.accountId === values.accountId && unchanged.kind === values.kind && unchanged.category === values.category;
      const kind = values.kind as "expense" | "income";
      if (!(await transactions.checkCategory(tx, values.accountId, kind, values.category, { allowArchived: same }))) {
        return { ok: false, reason: "invalid-input" };
      }
    }
    return { ok: true, values };
  }

  /**
   * The stored columns for checked form values. With the `existing` template, its day stays when the
   * next date still fits it (day 31 edited on 30 November stays day 31), and so does who set the
   * category when type and category are unchanged.
   */
  function columnsOf(values: TemplateValues, existing?: TemplateRow) {
    const { accountId, amountCents, kind, category, counterparty, counterpartyIban, reference, countsNextMonth, intervalMonths, nextDueDate, endDate } = values;
    return {
      accountId,
      amountCents,
      kind,
      category,
      ...transactions.encodeTexts({ counterparty, counterpartyIban, reference }),
      countsNextMonth,
      classifiedBy: !category
        ? ("auto" as const)
        : existing && existing.category === category && existing.kind === kind
          ? existing.classifiedBy
          : ("manual" as const),
      intervalMonths,
      dayOfMonth: existing && fitsDay(existing.dayOfMonth, nextDueDate) ? existing.dayOfMonth : Number(nextDueDate.slice(8, 10)),
      nextDueDate,
      endDate,
    };
  }

  return {
    async createTemplate(caller, input): Promise<TemplateResult> {
      return withSession(db, caller, async (tx, userId): Promise<TemplateResult> => {
        const checked = await checkInput(tx, input);
        if (!checked.ok) return checked;
        const [row] = await tx
          .insert(recurringTemplate)
          .values({ id: crypto.randomUUID(), ...columnsOf(checked.values), createdByUserId: userId })
          .returning();
        return { ok: true, template: toView(row, userId) };
      });
    },

    async getTemplate(caller, id, { archivedAccountIds = new Set<string>() } = {}) {
      return withSession(db, caller, async (tx, userId) => {
        const [row] = await tx.select().from(recurringTemplate).where(eq(recurringTemplate.id, id));
        return row ? toView(row, userId, archivedAccountIds) : null;
      });
    },

    async updateTemplate(caller, id, input): Promise<TemplateResult> {
      return withSession(db, caller, async (tx, userId): Promise<TemplateResult> => {
        const [row] = await tx.select().from(recurringTemplate).where(eq(recurringTemplate.id, id));
        if (!row) return { ok: false, reason: "not-found" };
        const checked = await checkInput(tx, input, row);
        if (!checked.ok) return checked;
        const [updated] = await tx
          .update(recurringTemplate)
          .set({ ...columnsOf(checked.values, row), updatedAt: new Date() })
          .where(eq(recurringTemplate.id, id))
          .returning();
        return { ok: true, template: toView(updated, userId) };
      });
    },

    async templateOfBookings(caller, bookingIds) {
      if (bookingIds.length === 0) return new Map();
      return withSession(db, caller, async (tx, userId) => {
        // Only bookings the caller may see: a template moved from a private account to a shared one
        // must not reveal the owner's private bookings.
        const visible = (await transactions.findBookings(tx, userId, { ids: [...bookingIds] })).map((booking) => booking.id);
        if (visible.length === 0) return new Map<string, string>();
        const found = await tx
          .select({ transactionId: recurringOccurrence.transactionId, templateId: recurringOccurrence.templateId })
          .from(recurringOccurrence)
          .where(inArray(recurringOccurrence.transactionId, visible));
        return new Map(found.map((row) => [row.transactionId as string, row.templateId]));
      });
    },

    async listSuggestions(caller) {
      const now = today();
      return withSession(db, caller, async (tx, userId) => {
        const visible = await transactions.findBookings(tx, userId, { from: suggestionWindowStart(now), to: now });
        // A bank statement covers imported bookings, so only bookings entered by hand are suggested.
        const imported = await importedBookingIds(tx, visible.map((booking) => booking.id));
        const bookings = visible.filter((booking) => !imported.has(booking.id));
        const templates = await tx.select().from(recurringTemplate);
        const covered = new Set(
          templates.flatMap((row) => {
            const { counterparty } = transactions.decodeTexts(row);
            return counterparty ? [`${row.accountId}:${normalizeCounterparty(counterparty)}`] : [];
          }),
        );
        const dismissed = new Set((await tx.select().from(recurringSuggestionDismissal)).map((row) => `${row.accountId}:${row.counterpartyIndex}`));
        const occurrences = await tx.select({ transactionId: recurringOccurrence.transactionId }).from(recurringOccurrence);
        return findSuggestions(bookings, {
          today: now,
          skip: (accountId, counterparty) => covered.has(`${accountId}:${counterparty}`) || dismissed.has(dismissalKey(accountId, counterparty)),
          templateBookingIds: new Set(occurrences.flatMap((row) => (row.transactionId ? [row.transactionId] : []))),
        });
      });
    },

    async dismissSuggestion(caller, input) {
      const parsed = dismissSuggestionSchema.safeParse(input);
      if (!parsed.success) return false;
      const { accountId, counterparty } = parsed.data;
      return withSession(db, caller, async (tx, userId) => {
        if (!(await accountIsVisible(tx, accountId))) return false;
        await tx
          .insert(recurringSuggestionDismissal)
          .values({
            id: crypto.randomUUID(),
            ownerUserId: userId,
            accountId,
            counterpartyIndex: fieldCrypto.blindIndex(normalizeCounterparty(counterparty), SUGGESTION_CONTEXT),
          })
          .onConflictDoNothing();
        return true;
      });
    },

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
