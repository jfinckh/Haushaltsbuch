import { auth } from "@/app/_lib/auth";
import { households } from "@/app/_lib/households";
import { householdsRoute } from "@/app/_lib/households-route";

export const { GET, POST } = householdsRoute({
  households,
  getUserId: async () => (await auth.getSession())?.user.id ?? null,
});
