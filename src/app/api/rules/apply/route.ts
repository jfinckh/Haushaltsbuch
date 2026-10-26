import { getCaller } from "@/app/_lib/caller";
import { createImportWorkflow } from "@/app/_lib/import-workflow";
import { imports } from "@/app/_lib/imports";
import { rules } from "@/app/_lib/rules";
import { applyRulesRoute } from "@/app/_lib/rules-route";
import { householdMembers, transfers } from "@/app/_lib/transfers";

const workflow = createImportWorkflow({ imports, rules, transfers, householdMembers });

export const { POST } = applyRulesRoute({ rules, afterApply: workflow.afterRulesApplied, getCaller });
