import "server-only";
import type { Budgets } from "@/budgets/server";
import { asCaller, invalidInput, json, notFound, readJson, type GetCaller } from "./api";

type Deps = {
  budgets: Budgets;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

type IdContext = { params: Promise<{ id: string }> };

const failed = (reason: "invalid-input" | "not-found" | "duplicate") =>
  reason === "not-found" ? notFound() : reason === "duplicate" ? json({ error: "duplicate" }, 409) : invalidInput();

/**
 * Handlers for /api/budgets. Budgets exist only where the caller may see their account: a budget or
 * account of another member's private account gets the same 404 as an unknown id.
 */
export function budgetsRoute({ budgets, getCaller }: Deps) {
  return {
    /** Body: { accountId, category, limit } with the limit as German amount text. */
    async POST(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const result = await budgets.createBudget(caller, await readJson(request));
        return result.ok ? json({ budget: result.budget }, 201) : failed(result.reason);
      });
    },
  };
}

/** Handlers for /api/budgets/[id]. */
export function budgetRoute({ budgets, getCaller }: Deps) {
  return {
    /** Body: { limit }. Only the limit can change. */
    async PATCH(request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const result = await budgets.updateBudget(caller, (await params).id, await readJson(request));
        return result.ok ? json({ budget: result.budget }) : failed(result.reason);
      });
    },

    async DELETE(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) =>
        (await budgets.deleteBudget(caller, (await params).id)) ? json({ deleted: true }) : notFound(),
      );
    },
  };
}
