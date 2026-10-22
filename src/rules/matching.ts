// Whether a rule fits a booking, and which rule wins. Pure; runs on the server after the booking's
// texts and the rule's patterns were decrypted.

/** How far a rule reaches: one account, the caller's private accounts, or the household's shared accounts. */
export type RuleLevel = "account" | "private" | "shared";

export type MatchableRule = {
  id: string;
  level: RuleLevel;
  /** Normalized or not; compared after normalizing. Null: no condition on this field. */
  counterparty: string | null;
  reference: string | null;
  amountSign: "negative" | "positive" | null;
  /** ISO timestamp of the last change. */
  updatedAt: string;
};

export type MatchableBooking = { counterparty: string | null; reference: string | null; amountCents: number };

const LEVEL_ORDER: Record<RuleLevel, number> = { account: 0, private: 1, shared: 2 };

/** Trimmed, whitespace collapsed, lower case (German rules). */
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase("de");
}

const contains = (text: string | null, pattern: string | null) =>
  pattern === null || (text !== null && normalizeText(text).includes(normalizeText(pattern)));

/** Every condition the rule names holds for the booking; a rule needs at least one pattern. */
export function ruleMatches(rule: MatchableRule, booking: MatchableBooking): boolean {
  if (rule.counterparty === null && rule.reference === null) return false;
  if (rule.amountSign === "negative" && booking.amountCents >= 0) return false;
  if (rule.amountSign === "positive" && booking.amountCents <= 0) return false;
  return contains(booking.counterparty, rule.counterparty) && contains(booking.reference, rule.reference);
}

/** The winning rule: account before private before shared, then the most recently changed. */
export function pickRule<T extends MatchableRule>(rules: readonly T[], booking: MatchableBooking): T | null {
  const fitting = rules.filter((rule) => ruleMatches(rule, booking));
  fitting.sort(
    (a, b) =>
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
  return fitting[0] ?? null;
}
