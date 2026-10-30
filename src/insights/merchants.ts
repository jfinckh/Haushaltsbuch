// The merchant ranking of the statistics page: spending grouped by a cleaned-up merchant name
// (pure, no database). Names are encrypted in the database, so grouping happens here, on bookings
// the bookings service has already decrypted for the caller.

/** What the ranking needs of an expense booking (cents, signed as booked: money out is negative). */
export type MerchantBooking = { amountCents: number; counterparty: string | null; reference: string | null };

/** A merchant: `key` groups spellings of the same merchant, `name` is this booking's spelling. */
export type Merchant = { key: string; name: string };

export type MerchantRow = {
  /** Null for the bookings without a merchant name. */
  key: string | null;
  /** The most frequent spelling; null for the bookings without a merchant name. */
  name: string | null;
  /** What was spent there (positive cents), refunds deducted. */
  spentCents: number;
  /** Bookings with money going out. */
  purchases: number;
  /** spentCents / purchases, rounded; 0 without purchases. */
  averageCents: number;
  /** What was spent there in the period before (positive cents, 0 if nothing). */
  previousCents: number;
};

export type MerchantRanking = {
  /** All spending of the period (positive cents): the sum of the rows. */
  totalCents: number;
  /** Merchants by spending, largest first; the bookings without a name last. */
  merchants: MerchantRow[];
  /** Whether the period before has any expenses, so a comparison means something. */
  hasPrevious: boolean;
};

/** A legal form at the end of a name, which does not tell merchants apart. */
const LEGAL_FORM = /[\s,]+(gmbh\s*&\s*co\.?\s*kg|gmbh|ag|se|kg|ug|e\.\s?k\.)\.?$/i;

/** What a PayPal booking's reference says the purchase was at. */
const PAYPAL_PURCHASE = /Ihr Einkauf bei\s+(.+?)\s*(?:[,;]|$)/i;

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The merchant of a booking, or null without a name. ING card payments lose their "VISA " prefix;
 * a PayPal payment names the merchant in its reference ("Ihr Einkauf bei …"), else it stays PayPal.
 * The key ignores case, spaces and a legal form at the end.
 */
export function merchantOf(counterparty: string | null, reference: string | null): Merchant | null {
  let name = tidy(counterparty ?? "");
  if (/^paypal\b/i.test(name)) {
    const purchase = reference?.match(PAYPAL_PURCHASE);
    name = purchase ? tidy(purchase[1]) : "PayPal";
  }
  name = name.replace(/^visa(\s+|$)/i, "");
  if (!name) return null;
  const lower = name.toLocaleLowerCase("de");
  return { key: lower.replace(LEGAL_FORM, "").trim() || lower, name };
}

type Group = { cents: number; purchases: number; spellings: Map<string, number> };

/** Spending per merchant key (null: no name), money out as positive cents. */
function groupByMerchant(bookings: MerchantBooking[]): Map<string | null, Group> {
  const groups = new Map<string | null, Group>();
  for (const { amountCents, counterparty, reference } of bookings) {
    const merchant = merchantOf(counterparty, reference);
    const key = merchant?.key ?? null;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { cents: 0, purchases: 0, spellings: new Map() }));
    group.cents -= amountCents;
    if (amountCents < 0) group.purchases += 1;
    if (merchant) group.spellings.set(merchant.name, (group.spellings.get(merchant.name) ?? 0) + 1);
  }
  return groups;
}

/** The most frequent spelling; on a tie the one seen first (the bookings come newest first). */
function mostFrequent(spellings: Map<string, number>): string | null {
  let best: string | null = null;
  let count = 0;
  for (const [spelling, n] of spellings) {
    if (n > count) [best, count] = [spelling, n];
  }
  return best;
}

/**
 * The period's expense bookings (newest first) ranked by merchant, each compared with the period
 * before. Merchants at zero or below (fully refunded) are left out.
 */
export function rankMerchants(bookings: MerchantBooking[], previous: MerchantBooking[]): MerchantRanking {
  const before = groupByMerchant(previous);
  const rows: MerchantRow[] = [...groupByMerchant(bookings)]
    .filter(([, group]) => group.cents > 0)
    .map(([key, group]) => ({
      key,
      name: key === null ? null : mostFrequent(group.spellings),
      spentCents: group.cents,
      purchases: group.purchases,
      averageCents: group.purchases > 0 ? Math.round(group.cents / group.purchases) : 0,
      previousCents: key === null ? 0 : Math.max(0, before.get(key)?.cents ?? 0),
    }));
  const named = rows.filter((row) => row.key !== null).sort((a, b) => b.spentCents - a.spentCents || a.name!.localeCompare(b.name!, "de"));
  return {
    totalCents: rows.reduce((sum, row) => sum + row.spentCents, 0),
    merchants: [...named, ...rows.filter((row) => row.key === null)],
    hasPrevious: previous.length > 0,
  };
}
