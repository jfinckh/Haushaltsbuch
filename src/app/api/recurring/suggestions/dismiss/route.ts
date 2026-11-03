import { getCaller } from "@/app/_lib/caller";
import { recurring } from "@/app/_lib/recurring";
import { dismissSuggestionRoute } from "@/app/_lib/recurring-route";

export const { POST } = dismissSuggestionRoute({ recurring, getCaller });
