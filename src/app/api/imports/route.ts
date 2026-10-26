import { accounts } from "@/app/_lib/accounts";
import { getCaller } from "@/app/_lib/caller";
import { createImportWorkflow } from "@/app/_lib/import-workflow";
import { imports } from "@/app/_lib/imports";
import { importsRoute } from "@/app/_lib/imports-route";
import { rules } from "@/app/_lib/rules";
import { householdMembers, transfers } from "@/app/_lib/transfers";

const workflow = createImportWorkflow({ imports, rules, transfers, householdMembers });

export const { GET, POST } = importsRoute({ imports, workflow, accounts, getCaller });
