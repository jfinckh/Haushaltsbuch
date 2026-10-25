import "server-only";
import type { Rules } from "@/rules/server";
import type { Caller } from "@/shared/rls";
import { asCaller, invalidInput, json, notFound, readJson, type GetCaller } from "./api";

type Deps = {
  rules: Rules;
  /**
   * Runs after rules were applied on demand with the bookings that became transfers, e.g. transfer
   * matching. If it fails, the rules' changes stay.
   */
  afterApply?: (caller: Caller, transfers: { id: string; target: "external" | null }[]) => Promise<unknown>;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

type IdContext = { params: Promise<{ id: string }> };

const failed = (reason: "invalid-input" | "not-found" | "no-household") =>
  reason === "not-found" ? notFound() : reason === "no-household" ? json({ error: "no-household" }, 400) : invalidInput();

/**
 * Handlers for /api/rules. Rules exist only where the caller may see them: a rule of another
 * member's private account or scope gets the same 404 as an unknown id.
 */
export function rulesRoute({ rules, getCaller }: Deps) {
  return {
    async GET() {
      return asCaller(getCaller, async (caller) => json({ rules: await rules.listRules(caller) }));
    },

    async POST(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const result = await rules.createRule(caller, await readJson(request));
        return result.ok ? json({ rule: result.rule }, 201) : failed(result.reason);
      });
    },
  };
}

/** Handlers for /api/rules/[id]. */
export function ruleRoute({ rules, getCaller }: Deps) {
  return {
    async GET(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const rule = await rules.getRule(caller, (await params).id);
        return rule ? json({ rule }) : notFound();
      });
    },

    /** Body: the whole rule, as for POST. */
    async PATCH(request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const result = await rules.updateRule(caller, (await params).id, await readJson(request));
        return result.ok ? json({ rule: result.rule }) : failed(result.reason);
      });
    },

    async DELETE(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) =>
        (await rules.deleteRule(caller, (await params).id)) ? json({ deleted: true }) : notFound(),
      );
    },
  };
}

/** Handlers for /api/rules/apply. */
export function applyRulesRoute({ rules, afterApply, getCaller }: Deps) {
  return {
    /** Body: { accountId }. Applies the rules to the account's bookings without category. */
    async POST(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const result = await rules.applyToAccount(caller, await readJson(request));
        if (!result.ok) return failed(result.reason);
        if (afterApply && result.transfers.length > 0) {
          try {
            await afterApply(caller, result.transfers);
          } catch (error) {
            // The rules' changes stay; matching runs again with the next import. Log no booking data.
            console.error("Transfer matching after applying rules failed", error instanceof Error ? error.name : "unknown");
          }
        }
        return json({ applied: result.applied });
      });
    },
  };
}

/** Handlers for /api/rules/suggestions/dismiss. */
export function dismissSuggestionRoute({ rules, getCaller }: Deps) {
  return {
    /** Body: { field, pattern }. Hides the suggestion for the caller only. */
    async POST(request: Request) {
      return asCaller(getCaller, async (caller) =>
        (await rules.dismissSuggestion(caller, await readJson(request))) ? new Response(null, { status: 204 }) : invalidInput(),
      );
    },
  };
}
