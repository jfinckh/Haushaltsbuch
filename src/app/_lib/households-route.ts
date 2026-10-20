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
  };
}
