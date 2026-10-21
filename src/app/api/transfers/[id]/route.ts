import { getCaller } from "@/app/_lib/caller";
import { transfers } from "@/app/_lib/transfers";
import { transferRoute } from "@/app/_lib/transfers-route";

export const { GET, POST } = transferRoute({ transfers, getCaller });
