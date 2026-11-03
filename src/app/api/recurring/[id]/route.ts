import { getCaller } from "@/app/_lib/caller";
import { recurring } from "@/app/_lib/recurring";
import { recurringRoute } from "@/app/_lib/recurring-route";

export const { PATCH, DELETE } = recurringRoute({ recurring, getCaller });
