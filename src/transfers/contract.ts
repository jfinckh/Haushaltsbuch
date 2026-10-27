import type { Result } from "@/shared/result";
import type { Caller } from "@/shared/rls";
import type { Member } from "./signals";
import type { AccountTransfers, NoPartnerTarget, TransferKind, TransferStatus } from "./types";

// The contract of the transfers part. createTransfers implements it. Views shared with the client
// components live in types.ts.

export type SharedContributionResult = Result<{ month: string; cents: number }, "invalid-input">;

export type SharedContributionsResult = Result<{ months: { month: string; cents: number }[] }, "invalid-input">;

/** A booking a rule typed as transfer or saving; target external: from or to an external own account. */
export type RuleTransfer = { id: string; target: "external" | null };

/** What matchAfterImport works on. */
export type MatchInput = { bookingIds: string[]; members: readonly Member[]; ruleTransfers?: readonly RuleTransfer[] };

/**
 * Transfers: two linked bookings, neither income nor expense. Manual decisions always win over
 * automatic matching. Every call is about the caller's own view.
 */
export interface Transfers {
  /**
   * After an import (or after rules were applied): stores the transfer hints of the bookings (read
   * in the caller's session) and matches them across all accounts of the household. Bookings a
   * rule typed as transfer or saving (`ruleTransfers`) wait for a partner; with target external
   * they are not listed as open. Manual decisions stay. Returns only counts of what the caller may see:
   * proposals that wait for another member are left out.
   */
  matchAfterImport(caller: Caller, input: MatchInput): Promise<{ linked: number; proposed: number }>;

  /**
   * A booking's transfer status, or null if the caller may not see it. `members`: the caller's
   * household members, for the names of hidden partners' owners.
   */
  statusOf(caller: Caller, id: string, members?: readonly Member[]): Promise<TransferStatus | null>;

  /** Open transfers and proposals of an account, or null if the caller may not see it. `members` as for statusOf. */
  accountOverview(caller: Caller, accountId: string, members?: readonly Member[]): Promise<AccountTransfers | null>;

  /** Links two bookings the caller may both see; their current links are dissolved. */
  link(caller: Caller, id: string, partnerId: string): Promise<"ok" | "not-found" | "invalid">;

  /** Dissolves the booking's link; the pair is never linked again automatically. */
  unlink(caller: Caller, id: string): Promise<boolean>;

  /** Accepts a proposal the caller sees one side of (the database function transfers_accept decides). */
  acceptProposal(caller: Caller, pairId: string): Promise<"ok" | "not-found" | "taken">;

  /** Rejects a proposal (or dissolves a link) the caller sees one side of. */
  rejectProposal(caller: Caller, pairId: string): Promise<boolean>;

  /**
   * Sets the type by hand. Expense or income dissolves the link and rules out a partner; transfer
   * or saving applies to both sides of a linked pair. Matching never changes it again.
   */
  setKind(caller: Caller, id: string, kind: TransferKind): Promise<boolean>;

  /** Marks a booking as a transfer without partner: from or to an external own account, or a visible account. */
  markWithoutPartner(caller: Caller, id: string, target: NoPartnerTarget): Promise<"ok" | "not-found" | "invalid">;

  /**
   * Net transfers between the caller's own private accounts and shared accounts in a calendar month
   * (cents, signed as booked on the private side: negative = paid into shared accounts). Counts
   * bookings of type transfer whose linked partner, or whose target without partner, is on a shared
   * account. Transfers between own accounts, to an external own account, to a hidden account or
   * still open do not count. Only the caller's own private bookings are read.
   */
  sharedContribution(caller: Caller, month: string): Promise<SharedContributionResult>;

  /** The shared contribution (as sharedContribution) of each month from `from` to `to` (YYYY-MM, at most 24), newest first. */
  sharedContributions(caller: Caller, from: string, to: string): Promise<SharedContributionsResult>;

  /** A manual action on a booking, from the API (input checked here). */
  applyAction(caller: Caller, id: string, input: unknown): Promise<"ok" | "not-found" | "invalid" | "invalid-input">;

  /** Accepts or rejects a proposal, from the API (input checked here). */
  decideProposal(caller: Caller, pairId: string, input: unknown): Promise<"ok" | "not-found" | "taken" | "invalid-input">;
}
