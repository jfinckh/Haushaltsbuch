import { getCaller } from "@/app/_lib/caller";
import { rules } from "@/app/_lib/rules";
import { dismissSuggestionRoute } from "@/app/_lib/rules-route";

export const { POST } = dismissSuggestionRoute({ rules, getCaller });
