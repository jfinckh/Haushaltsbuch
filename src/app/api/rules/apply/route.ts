import { getCaller } from "@/app/_lib/caller";
import { rules } from "@/app/_lib/rules";
import { applyRulesRoute } from "@/app/_lib/rules-route";
import { householdMembers, transfers } from "@/app/_lib/transfers";

export const { POST } = applyRulesRoute({
  rules,
  getCaller,
  afterApply: async (caller, ruleTransfers) =>
    transfers.matchAfterImport(caller, {
      bookingIds: ruleTransfers.map((item) => item.id),
      members: await householdMembers(caller),
      ruleTransfers,
    }),
});
