// Template suggestions: bookings that come back on a fixed rhythm with similar amounts, e.g. a
// subscription every month. Pure; runs on the server after the booking texts were decrypted.
// Only suggests: the app never creates a template by itself.

export type SuggestionBooking = {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  kind: "expense" | "income" | "transfer" | "saving";
  category: string | null;
  counterparty: string | null;
};

export type RecurringSuggestion = {
  accountId: string;
  /** As written in the newest booking. */
  counterparty: string;
  kind: SuggestionBooking["kind"];
  /** The newest booking's category; null for transfers and saving. */
  category: string | null;
  /** The newest booking's amount. */
  amountCents: number;
  intervalMonths: 1 | 3 | 6 | 12;
  count: number;
  lastDate: string;
  /** The first date of the series on or after today (after the last booking). */
  nextDueDate: string;
};

export type SuggestionOptions = {
  today: string;
  /** Whether a group is left out (a template exists, or the person hid it); counterparty normalized. */
  skip: (accountId: string, normalizedCounterparty: string) => boolean;
  /** Bookings a template made; a group with any of them is left out. */
  templateBookingIds: ReadonlySet<string>;
};

/** How far back the page looks for bookings, in months (two years plus a little for yearly ones). */
export const SUGGESTION_WINDOW_MONTHS = 25;

const INTERVALS = [1, 3, 6, 12] as const;
const MIN_COUNT: Record<(typeof INTERVALS)[number], number> = {
  1: 3,
  3: 3,
  6: 3,
  12: 2,
};
const DAYS_PER_MONTH = 30.44;
const DRIFT_DAYS = 5;
const AMOUNT_TOLERANCE = 0.1;

const pad = (n: number) => String(n).padStart(2, "0");

/** Lower case, trimmed, single spaces: "  NETFLIX  Int " → "netflix int". */
export function normalizeCounterparty(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase("de");
}

const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** The date `months` months after the first day of `date`'s month, on `day` or the month's last day. */
function dateInMonth(date: string, months: number, day: number): string {
  const [year, month] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(day, lastDay))}`;
}

/** YYYY-MM-DD `months` calendar months before `date` (day clamped to the month's end). */
function monthsBefore(date: string, months: number): string {
  return dateInMonth(date, -months, Number(date.slice(8, 10)));
}

/**
 * The first date of the series that starts at `anchor` and steps `intervalMonths` months (the
 * anchor's day, or the month's last day) on or after `from`. Same rule as SQL recurring_due_after.
 */
export function seriesDateOnOrAfter(
  anchor: string,
  intervalMonths: number,
  from: string,
): string {
  const day = Number(anchor.slice(8, 10));
  for (let step = 0; ; step += intervalMonths) {
    const date = dateInMonth(anchor, step, day);
    if (date >= from) return date;
  }
}

/** The first day the suggestions look at: SUGGESTION_WINDOW_MONTHS before today. */
export function suggestionWindowStart(today: string): string {
  return monthsBefore(today, SUGGESTION_WINDOW_MONTHS);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The latest run of a group (oldest first, newest last): walking back from the newest booking while
 * each gap fits the interval and each amount stays near the newest one. A price rise or a skipped
 * month ends the run, so the series after it still counts. The smallest interval with a long enough
 * run wins; null when none has one.
 */
function latestRun(sorted: SuggestionBooking[]): { intervalMonths: (typeof INTERVALS)[number]; run: SuggestionBooking[] } | null {
  const newest = sorted[sorted.length - 1];
  const near = (amount: number) =>
    Math.sign(amount) === Math.sign(newest.amountCents) && Math.abs(Math.abs(amount) - Math.abs(newest.amountCents)) < Math.abs(newest.amountCents) * AMOUNT_TOLERANCE;
  for (const months of INTERVALS) {
    const expected = months * DAYS_PER_MONTH;
    const run = [newest];
    for (let i = sorted.length - 2; i >= 0; i--) {
      const gap = (toTime(run[0].date) - toTime(sorted[i].date)) / 86_400_000;
      if (Math.abs(gap - expected) > DRIFT_DAYS || !near(sorted[i].amountCents)) break;
      run.unshift(sorted[i]);
    }
    if (run.length >= MIN_COUNT[months] && similarAmounts(run.map((b) => b.amountCents))) return { intervalMonths: months, run };
  }
  return null;
}

/** Whether all amounts have the same sign and lie less than 10 % from their median. */
function similarAmounts(amounts: number[]): boolean {
  if (!amounts.every((a) => Math.sign(a) === Math.sign(amounts[0])))
    return false;
  const typical = Math.abs(median(amounts));
  return amounts.every(
    (a) => Math.abs(Math.abs(a) - typical) < typical * AMOUNT_TOLERANCE,
  );
}

const dayAfter = (date: string) =>
  new Date(toTime(date) + 86_400_000).toISOString().slice(0, 10);

/** Suggestions from visible bookings, newest last booking first. */
export function findSuggestions(
  bookings: readonly SuggestionBooking[],
  { today, skip, templateBookingIds }: SuggestionOptions,
): RecurringSuggestion[] {
  const groups = new Map<string, SuggestionBooking[]>();
  for (const booking of bookings) {
    if (!booking.counterparty?.trim()) continue;
    const key = JSON.stringify([
      booking.accountId,
      normalizeCounterparty(booking.counterparty),
      booking.kind,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), booking]);
  }

  const suggestions: { suggestion: RecurringSuggestion; normalized: string }[] =
    [];
  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    const newest = sorted[sorted.length - 1];
    const normalized = normalizeCounterparty(newest.counterparty as string);
    if (
      skip(newest.accountId, normalized) ||
      sorted.some((b) => templateBookingIds.has(b.id))
    )
      continue;
    const found = latestRun(sorted);
    if (found === null) continue;
    const { intervalMonths, run } = found;
    if (newest.date < monthsBefore(today, 2 * intervalMonths)) continue;
    suggestions.push({
      normalized,
      suggestion: {
        accountId: newest.accountId,
        counterparty: newest.counterparty as string,
        kind: newest.kind,
        category:
          newest.kind === "expense" || newest.kind === "income"
            ? newest.category
            : null,
        amountCents: newest.amountCents,
        intervalMonths,
        count: run.length,
        lastDate: newest.date,
        nextDueDate: seriesDateOnOrAfter(
          newest.date,
          intervalMonths,
          today > newest.date ? today : dayAfter(newest.date),
        ),
      },
    });
  }

  return suggestions
    .sort(
      (a, b) =>
        b.suggestion.lastDate.localeCompare(a.suggestion.lastDate) ||
        a.suggestion.accountId.localeCompare(b.suggestion.accountId) ||
        a.normalized.localeCompare(b.normalized),
    )
    .map(({ suggestion }) => suggestion);
}
