import "server-only";
import type { ConfirmResult, Imports } from "@/import/server";
import type { ApplyResult, Rules } from "@/rules/server";
import type { Caller } from "@/shared/rls";
import type { Transfers } from "@/transfers/server";

// What happens after bank bookings arrive: the import (which also sets the opening balance of an
// empty account), then the rules, then transfer matching. Rules come first: matching may still link
// a booking a rule typed, but never overrides a rule with its weaker "looks like a transfer" hint.
// Rules and matching run in their own database transactions; if they fail, the import stays and
// they can be redone (rules page, manual linking). Errors are logged by name only, never with
// booking data.

type Deps = {
  imports: Pick<Imports, "confirm">;
  /** Without it, imports apply no rules. */
  rules?: Pick<Rules, "applyToBookings">;
  /** Without it, imports start no transfer matching. */
  transfers?: Pick<Transfers, "matchAfterImport">;
  /** The caller's household members with names, for matching. */
  householdMembers: (caller: Caller) => Promise<{ userId: string; name: string }[]>;
};

type RuleTransfers = ApplyResult["transfers"];

export type ConfirmedImport = Extract<ConfirmResult, { ok: true }> & {
  /** How many bookings the rules sorted, or null if they did not run. */
  rules: { applied: number } | null;
  /** What matching linked and proposed, or null if it did not run. */
  transfers: { linked: number; proposed: number } | null;
};

export type ConfirmImportResult = ConfirmedImport | Extract<ConfirmResult, { ok: false }>;

export interface ImportWorkflow {
  /** Confirms an upload (see Imports.confirm), then applies the rules and matches transfers. */
  confirm(caller: Caller, input: unknown): Promise<ConfirmImportResult>;
  /** After rules were applied on demand: matches the bookings that became transfers. */
  afterRulesApplied(caller: Caller, ruleTransfers: RuleTransfers): Promise<void>;
}

export function createImportWorkflow({ imports, rules, transfers, householdMembers }: Deps): ImportWorkflow {
  async function match(caller: Caller, bookingIds: string[], ruleTransfers: RuleTransfers) {
    if (!transfers) return null;
    try {
      return await transfers.matchAfterImport(caller, { bookingIds, members: await householdMembers(caller), ruleTransfers });
    } catch (error) {
      console.error("Transfer matching failed", error instanceof Error ? error.name : "unknown");
      return null;
    }
  }

  return {
    async confirm(caller, input) {
      const result = await imports.confirm(caller, input);
      if (!result.ok) return result;
      // Merged bookings go along: rules and matching both leave what a person decided as it is.
      const bookingIds = [...result.bookingIds, ...result.mergedIds];
      let applied: ApplyResult | null = null;
      if (rules) {
        try {
          applied = await rules.applyToBookings(caller, bookingIds);
        } catch (error) {
          console.error("Applying rules after import failed", error instanceof Error ? error.name : "unknown");
        }
      }
      return {
        ...result,
        rules: applied && { applied: applied.applied },
        transfers: await match(caller, bookingIds, applied?.transfers ?? []),
      };
    },

    async afterRulesApplied(caller, ruleTransfers) {
      if (ruleTransfers.length === 0) return;
      await match(caller, ruleTransfers.map((item) => item.id), ruleTransfers);
    },
  };
}
