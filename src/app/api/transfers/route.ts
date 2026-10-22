import { getCaller } from "@/app/_lib/caller";
import { householdMembers, transfers } from "@/app/_lib/transfers";
import { transfersRoute } from "@/app/_lib/transfers-route";

export const { GET } = transfersRoute({ transfers, members: householdMembers, getCaller });
