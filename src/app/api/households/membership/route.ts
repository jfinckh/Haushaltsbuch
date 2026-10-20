import { auth } from "@/app/_lib/auth";
import { households } from "@/app/_lib/households";
import { householdMembershipRoute } from "@/app/_lib/households-route";

export const { DELETE } = householdMembershipRoute({
  households,
  getUserId: async () => (await auth.getSession())?.user.id ?? null,
});
