import { budgets } from "@/app/_lib/budgets";
import { budgetsRoute } from "@/app/_lib/budgets-route";
import { getCaller } from "@/app/_lib/caller";

export const { POST } = budgetsRoute({ budgets, getCaller });
