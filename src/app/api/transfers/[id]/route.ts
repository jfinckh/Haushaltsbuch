import { getCaller } from "@/app/_lib/caller";
import { rules } from "@/app/_lib/rules";
import { householdMembers, transfers } from "@/app/_lib/transfers";
import { transferRoute } from "@/app/_lib/transfers-route";

export const { GET, POST } = transferRoute({ transfers, rules, members: householdMembers, getCaller });
