import { getCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { householdMembershipRoute } from "@/app/_lib/households-route";

export const { DELETE } = householdMembershipRoute({ households, getCaller });
