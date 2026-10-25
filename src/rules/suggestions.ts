// Rule suggestions: words that keep coming back in bookings no rule covers yet. Pure; runs on the
// server after the booking texts were decrypted. Suggests only the condition, never a category.

import { normalizeText } from "./matching";

export type SuggestionField = "counterparty" | "reference";

export type SuggestionBooking = {
  id: string;
  accountId: string;
  amountCents: number;
  counterparty: string | null;
  reference: string | null;
};

export type RuleSuggestion = {
  field: SuggestionField;
  /** The word or phrase as the bank wrote it in the first booking. */
  pattern: string;
  count: number;
  /** One booking's counterparty, for context. */
  example: string | null;
  /** The account with the most of these bookings, preselected as the rule's scope. */
  accountId: string;
  /** Expense when most bookings are negative, else income. */
  kind: "expense" | "income";
};

/** Whether the member hid this suggestion; `pattern` is normalized. */
export type IsDismissed = (field: SuggestionField, pattern: string) => boolean;

const MIN_COUNT = 3;
/** A reference word shared by more counterparties than this is too generic (a city, a card network). */
const MAX_REFERENCE_COUNTERPARTIES = 2;

// Words that say nothing about the shop: card and payment networks, booking texts, legal forms and
// filler words. Words shorter than 3 letters and words with digits are dropped anyway.
const NOISE = new Set([
  "visa", "mastercard", "maestro", "girocard", "lastschrift", "gutschrift", "kaufumsatz", "xxxx",
  "apple", "google", "pay", "paypal", "klarna", "sumup", "europe", "cie", "s.c.a", "sca",
  "gmbh", "mbh", "ag", "kg", "ohg", "e.k", "e.v", "ltd", "inc", "sarl", "s.a.r.l",
  "und", "der", "die", "das", "von", "mit", "für", "bei", "ihr", "ihre", "einkauf", "sagt", "danke",
]);

const SEPARATORS = /[\s,;:/()|*"]+/u;

/** A text's words in order, original case, trailing dots trimmed. */
const tokensOf = (text: string) =>
  text
    .split(SEPARATORS)
    .map((token) => token.replace(/^[.\-']+|[.\-']+$/g, ""))
    .filter(Boolean);

const lower = (token: string) => token.toLocaleLowerCase("de");

/** A word worth looking at: at least 3 letters, no digits, not noise. */
const meaningful = (token: string) => token.length >= 3 && !/\d/.test(token) && !NOISE.has(lower(token));

type Prepared = { booking: SuggestionBooking; tokens: Record<SuggestionField, string[]>; normalized: Record<SuggestionField, string>; firstWord: string | null };

type Candidate = { field: SuggestionField; pattern: string; bookings: Prepared[] };

function prepare(booking: SuggestionBooking): Prepared {
  const tokens = {
    counterparty: booking.counterparty ? tokensOf(booking.counterparty) : [],
    reference: booking.reference ? tokensOf(booking.reference) : [],
  };
  const first = tokens.counterparty.find(meaningful);
  return {
    booking,
    tokens,
    normalized: {
      counterparty: booking.counterparty ? normalizeText(booking.counterparty) : "",
      reference: booking.reference ? normalizeText(booking.reference) : "",
    },
    firstWord: first ? lower(first) : null,
  };
}

/**
 * The phrase starting at `start` in the first booking's `field`, extended word by word while every
 * booking still contains it. Stops before noise and words with digits.
 */
function phrase(field: SuggestionField, start: number, bookings: Prepared[]): string {
  const tokens = bookings[0].tokens[field];
  let end = start + 1;
  while (end < tokens.length && meaningful(tokens[end])) {
    const longer = normalizeText(tokens.slice(start, end + 1).join(" "));
    if (!bookings.every((b) => b.normalized[field].includes(longer))) break;
    end++;
  }
  return tokens.slice(start, end).join(" ");
}

function groupBy<T>(items: T[], key: (item: T) => string[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    for (const k of new Set(key(item))) groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}

/** A shop is usually the first word of the counterparty ("EDEKA" in "VISA EDEKA MUSTERMARKT"). */
function counterpartyCandidates(prepared: Prepared[]): Candidate[] {
  const groups = groupBy(prepared, (p) => (p.firstWord ? [p.firstWord] : []));
  return [...groups.entries()]
    .filter(([, bookings]) => bookings.length >= MIN_COUNT)
    .map(([word, bookings]) => {
      const start = bookings[0].tokens.counterparty.findIndex((t) => lower(t) === word);
      return { field: "counterparty" as const, pattern: phrase("counterparty", start, bookings), bookings };
    });
}

/**
 * Reference words that come back with few counterparties ("EasyPark" behind PayPal, "Miete" from
 * two people). Words of the same bookings become one phrase; bookings a counterparty suggestion
 * already covers are not suggested again.
 */
function referenceCandidates(prepared: Prepared[], covered: Set<string>): Candidate[] {
  const groups = groupBy(prepared, (p) => p.tokens.reference.filter(meaningful).map(lower));
  const bySet = new Map<string, Prepared[]>();
  for (const bookings of groups.values()) {
    if (bookings.length < MIN_COUNT) continue;
    const counterparties = new Set(bookings.map((b) => b.firstWord ?? b.normalized.counterparty));
    if (counterparties.size > MAX_REFERENCE_COUNTERPARTIES) continue;
    if (bookings.every((b) => covered.has(b.booking.id))) continue;
    bySet.set(bookings.map((b) => b.booking.id).join(","), bookings);
  }
  return [...bySet.values()].map((bookings) => {
    const first = bookings[0].tokens.reference;
    // The earliest word of the group in the first booking starts the phrase.
    const start = first.findIndex((t) => meaningful(t) && bookings.every((b) => b.tokens.reference.some((u) => lower(u) === lower(t))));
    return { field: "reference" as const, pattern: phrase("reference", start, bookings), bookings };
  });
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}

function toSuggestion({ field, pattern, bookings }: Candidate): RuleSuggestion {
  const negative = bookings.filter((b) => b.booking.amountCents < 0).length;
  return {
    field,
    pattern,
    count: bookings.length,
    example: bookings[0].booking.counterparty,
    accountId: mostCommon(bookings.map((b) => b.booking.accountId)),
    kind: negative * 2 >= bookings.length ? "expense" : "income",
  };
}

/**
 * Suggestions for `bookings` (expenses and income no rule covers yet): at least 3 bookings each,
 * most bookings first, hidden ones left out.
 */
export function findSuggestions(
  bookings: SuggestionBooking[],
  isDismissed: IsDismissed,
  { limit = 10 }: { limit?: number } = {},
): RuleSuggestion[] {
  const prepared = bookings.map(prepare);
  const byCounterparty = counterpartyCandidates(prepared);
  // Hidden counterparty suggestions still cover their bookings, so their card noise stays quiet.
  const covered = new Set(byCounterparty.flatMap((c) => c.bookings.map((b) => b.booking.id)));
  const byReference = referenceCandidates(prepared, covered);
  return [...byCounterparty, ...byReference]
    .filter((c) => !isDismissed(c.field, normalizeText(c.pattern)))
    .map(toSuggestion)
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern, "de"))
    .slice(0, limit);
}
