// Which imported rows merge with bookings entered by hand (docs/konzept.md, "Keine doppelten
// Buchungen"): same amount, booking dates at most MERGE_DAYS apart, one to one, closest dates first.

/** How many days a bank row and a booking entered by hand may be apart. */
export const MERGE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Days between two plain dates (YYYY-MM-DD), always positive. */
export function dayGap(a: string, b: string): number {
  return Math.abs(Math.round((toTime(a) - toTime(b)) / DAY_MS));
}

/** A plain date shifted by `days`. */
export function shiftDate(date: string, days: number): string {
  return new Date(toTime(date) + days * DAY_MS).toISOString().slice(0, 10);
}

type Row = { line: number; bookingDate: string; amountCents: number };
type Candidate = { id: string; date: string; amountCents: number };

/**
 * Pairs rows with candidate bookings: every pair with the same amount and at most MERGE_DAYS apart,
 * smallest gap first (then lower line, older booking, id), taken while neither side is taken yet.
 * Returns booking ids by line.
 */
export function proposeMerges(rows: readonly Row[], candidates: readonly Candidate[]): Map<number, string> {
  const pairs = rows.flatMap((row) =>
    candidates
      .filter((candidate) => candidate.amountCents === row.amountCents)
      .map((candidate) => ({ row, candidate, gap: dayGap(row.bookingDate, candidate.date) }))
      .filter((pair) => pair.gap <= MERGE_DAYS),
  );
  pairs.sort(
    (a, b) =>
      a.gap - b.gap ||
      a.row.line - b.row.line ||
      a.candidate.date.localeCompare(b.candidate.date) ||
      a.candidate.id.localeCompare(b.candidate.id),
  );
  const merges = new Map<number, string>();
  const taken = new Set<string>();
  for (const { row, candidate } of pairs) {
    if (merges.has(row.line) || taken.has(candidate.id)) continue;
    merges.set(row.line, candidate.id);
    taken.add(candidate.id);
  }
  return merges;
}
