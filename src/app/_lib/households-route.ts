import "server-only";
import type { Households } from "@/households/server";
import { asCaller, invalidInput, json, notFound, readJson, type GetCaller } from "./api";

type Deps = {
  households: Households;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

/** Handlers for /api/households. Every response is about the caller's own household only. */
export function householdsRoute({ households, getCaller }: Deps) {
  return {
    async GET() {
      return asCaller(getCaller, async (caller) => {
        const household = await households.getHousehold(caller);
        if (!household) return notFound();
        return json({ household });
      });
    },

    async POST(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const result = await households.createHousehold(caller, await readJson(request));
        if (result.ok) return json({ household: result.household }, 201);
        if (result.reason === "already-member") return json({ error: "Already in a household" }, 409);
        return invalidInput();
      });
    },

    /** Renames the caller's household. Any id in the request is ignored. */
    async PATCH(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const result = await households.renameHousehold(caller, await readJson(request));
        if (result.ok) return json({ household: result.household });
        if (result.reason === "no-household") return notFound();
        return invalidInput();
      });
    },
  };
}

/** Handlers for /api/households/membership: the caller's own membership only. */
export function householdMembershipRoute({ households, getCaller }: Deps) {
  return {
    /** Leaves the caller's household. The last member to leave deletes it. */
    async DELETE() {
      return asCaller(getCaller, async (caller) => {
        const result = await households.leaveHousehold(caller);
        if (!result.left) return notFound();
        return json({ householdDeleted: result.householdDeleted });
      });
    },
  };
}
