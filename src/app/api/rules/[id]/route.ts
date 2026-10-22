import { getCaller } from "@/app/_lib/caller";
import { rules } from "@/app/_lib/rules";
import { ruleRoute } from "@/app/_lib/rules-route";

export const { GET, PATCH, DELETE } = ruleRoute({ rules, getCaller });
