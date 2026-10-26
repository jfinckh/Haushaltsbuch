import { getCaller } from "@/app/_lib/caller";
import { currentInvite } from "@/app/_lib/current-invite";
import { households } from "@/app/_lib/households";
import { householdMembershipRoute } from "@/app/_lib/households-route";

export const { DELETE } = householdMembershipRoute({ households, getCaller, currentInvite });
