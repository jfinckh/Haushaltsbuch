import { getCaller } from "@/app/_lib/caller";
import { transfers } from "@/app/_lib/transfers";
import { proposalRoute } from "@/app/_lib/transfers-route";

export const { POST } = proposalRoute({ transfers, getCaller });
