import { getCaller } from "@/app/_lib/caller";
import { rules } from "@/app/_lib/rules";
import { rulesRoute } from "@/app/_lib/rules-route";

export const { GET, POST } = rulesRoute({ rules, getCaller });
