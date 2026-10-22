import { budgets } from "@/app/_lib/budgets";
import { budgetRoute } from "@/app/_lib/budgets-route";
import { getCaller } from "@/app/_lib/caller";

export const { PATCH, DELETE } = budgetRoute({ budgets, getCaller });
