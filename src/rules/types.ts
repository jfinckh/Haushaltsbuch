// What callers see of rules. Browser-safe: the pages and forms get these shapes as props.

export type RuleKind = "expense" | "income" | "transfer" | "saving";

/** Where a rule applies: one account, all shared accounts of the household, or all my private accounts. */
export type RuleScope = { type: "account"; accountId: string } | { type: "shared" } | { type: "private" };

export type RuleView = {
  id: string;
  scope: RuleScope;
  /** Counterparty contains this text (or no condition). */
  counterparty: string | null;
  /** Reference (Verwendungszweck) contains this text (or no condition). */
  reference: string | null;
  amountSign: "negative" | "positive" | null;
  kind: RuleKind;
  category: string | null;
  /** For transfer and saving: from or to an external own account. */
  transferTarget: "external" | null;
  createdByMe: boolean;
  /** ISO timestamp. */
  updatedAt: string;
};

/** What applying rules did: how many bookings changed, and those that became transfers. */
export type ApplyResult = { applied: number; transfers: { id: string; target: "external" | null }[] };

/** An account as the rules forms show it. */
export type RuleAccount = { id: string; name: string };
