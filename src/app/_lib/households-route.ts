import "server-only";
import type { createHouseholds } from "@/households/server";

type Deps = {
  households: ReturnType<typeof createHouseholds>;
  /** The signed-in user's id, or null. */
  getUserId: () => Promise<string | null>;
};

/** Handlers for /api/households. Every response is about the caller's own household only. */
export function householdsRoute({ households, getUserId }: Deps) {
  return {
    async GET() {
      const userId = await getUserId();
      if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const household = await households.getHousehold(userId);
      if (!household) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ household });
    },

    async POST(request: Request) {
      const userId = await getUserId();
      if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const body = await request.json().catch(() => null);
      const result = await households.createHousehold(userId, body);
      if (result.ok) return Response.json({ household: result.household }, { status: 201 });
      if (result.reason === "already-member") return Response.json({ error: "Already in a household" }, { status: 409 });
      return Response.json({ error: "Invalid input" }, { status: 400 });
    },

    /** Renames the caller's household. Any id in the request is ignored. */
    async PATCH(request: Request) {
      const userId = await getUserId();
      if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const body = await request.json().catch(() => null);
      const result = await households.renameHousehold(userId, body);
      if (result.ok) return Response.json({ household: result.household });
      if (result.reason === "no-household") return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ error: "Invalid input" }, { status: 400 });
    },
  };
}

/** Handlers for /api/households/membership: the caller's own membership only. */
export function householdMembershipRoute({ households, getUserId }: Deps) {
  return {
    /** Leaves the caller's household. The last member to leave deletes it. */
    async DELETE() {
      const userId = await getUserId();
      if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const result = await households.leaveHousehold(userId);
      if (!result.left) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ householdDeleted: result.householdDeleted });
    },
  };
}
