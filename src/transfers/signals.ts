import { isValidIban, normalizeIban } from "@/shared/iban";

// Hints that a booking is a transfer between own accounts (docs/konzept.md, "Umbuchungen & Sparen").
// They are computed in the session of whoever may read the booking and stored without text: the
// blind index of a mentioned IBAN, a bank key, and a member's user id. Whether a hint points at an
// account of the household is decided in the database (drizzle/0016_transfers_functions.sql).

export type TransferSignals = {
  /** Blind index of the counterparty IBAN or a valid IBAN in the text (same as the accounts' IBAN index). */
  mentionedIbanIndex: string | null;
  /** The bank the text names. */
  mentionedBank: "trade_republic" | null;
  /** The household member whose name is the counterparty. */
  counterpartyMemberId: string | null;
};

export type Member = { userId: string; name: string };

type BookingTexts = { counterparty: string | null; counterpartyIban: string | null; reference: string | null };

const BANK_NAMES = [{ bank: "trade_republic", pattern: /trade\s*republic/i }] as const;
const IBAN_IN_TEXT = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g;

const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("de");

function mentionedIban({ counterpartyIban, counterparty, reference }: BookingTexts): string | null {
  if (counterpartyIban) return normalizeIban(counterpartyIban);
  for (const text of [reference, counterparty]) {
    for (const match of text?.toUpperCase().match(IBAN_IN_TEXT) ?? []) {
      const iban = normalizeIban(match);
      if (isValidIban(iban)) return iban;
    }
  }
  return null;
}

/**
 * The transfer hints of one booking, or null if it has none. `ibanIndex` makes the blind index of a
 * normalized IBAN with the accounts' key and context.
 */
export function transferSignals(
  booking: BookingTexts,
  members: readonly Member[],
  ibanIndex: (iban: string) => string,
): TransferSignals | null {
  const iban = mentionedIban(booking);
  const texts = [booking.counterparty, booking.reference].filter((text): text is string => Boolean(text));
  const mentionedBank = BANK_NAMES.find(({ pattern }) => texts.some((text) => pattern.test(text)))?.bank ?? null;
  const counterparty = booking.counterparty && normalizeName(booking.counterparty);
  const member = counterparty ? members.find((m) => normalizeName(m.name) === counterparty) : undefined;
  const signals = {
    mentionedIbanIndex: iban && ibanIndex(iban),
    mentionedBank,
    counterpartyMemberId: member?.userId ?? null,
  };
  return signals.mentionedIbanIndex || signals.mentionedBank || signals.counterpartyMemberId ? signals : null;
}
