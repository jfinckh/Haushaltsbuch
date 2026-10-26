import type { Caller } from "@/shared/rls";
import type { RuleSuggestion } from "./suggestions";
import type { ApplyResult, RuleView } from "./types";

// The contract of the rules part. createRules implements it. Views shared with the client
// components live in types.ts.

export type SaveRuleResult =
  | { ok: true; rule: RuleView }
  | { ok: false; reason: "invalid-input" | "not-found" | "no-household" };

export type ApplyToAccountResult = ({ ok: true } & ApplyResult) | { ok: false; reason: "invalid-input" | "not-found" };

/**
 * Rules that sort bookings. Every call is about the caller's own view; their user id comes from
 * the database. Rules run only on bookings the caller may see, and only when the rule's scope fits
 * the booking's account.
 */
export interface Rules {
  /** The rules the caller may see, most recently changed first. */
  listRules(caller: Caller): Promise<RuleView[]>;

  /** One rule, or null if it does not exist or the caller may not see it. */
  getRule(caller: Caller, id: string): Promise<RuleView | null>;

  /** Adds a rule in a scope the caller may use. */
  createRule(caller: Caller, input: unknown): Promise<SaveRuleResult>;

  /** Replaces a visible rule (the whole rule); the new scope must be one the caller may use. */
  updateRule(caller: Caller, id: string, input: unknown): Promise<SaveRuleResult>;

  /** Deletes a visible rule; false if there is none the caller may see. */
  deleteRule(caller: Caller, id: string): Promise<boolean>;

  /**
   * "Künftig immer so": a rule for the booking's account with the booking's current type and
   * category, looking for `pattern` in the chosen field. The pattern must occur in that field.
   * A transfer or saving rule also takes the booking's sign.
   * `transferTarget` external: the booking was marked as a transfer from or to an external own account.
   */
  createFromBooking(caller: Caller, bookingId: string, input: unknown, transferTarget?: "external" | null): Promise<SaveRuleResult>;

  /**
   * Rule suggestions from the caller's visible expenses and income of the last 12 months that no
   * visible rule covers; hidden ones are left out. `today` (YYYY-MM-DD) is for tests.
   */
  listSuggestions(caller: Caller, options?: { today?: string }): Promise<RuleSuggestion[]>;

  /** "Nicht mehr vorschlagen": hides a suggestion for the caller only. Repeating it changes nothing. */
  dismissSuggestion(caller: Caller, input: unknown): Promise<boolean>;

  /** After an import: applies the rules to the new bookings (only those nobody classified yet). */
  applyToBookings(caller: Caller, bookingIds: string[]): Promise<ApplyResult>;

  /** Applies the rules to an account's uncategorized expenses and income. */
  applyToAccount(caller: Caller, input: unknown): Promise<ApplyToAccountResult>;
}
