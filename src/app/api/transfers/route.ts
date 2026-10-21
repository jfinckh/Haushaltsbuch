import { getCaller } from "@/app/_lib/caller";
import { transfers } from "@/app/_lib/transfers";
import { transfersRoute } from "@/app/_lib/transfers-route";

export const { GET } = transfersRoute({ transfers, getCaller });
