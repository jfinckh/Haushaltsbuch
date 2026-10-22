import { accounts } from "@/app/_lib/accounts";
import { getCaller } from "@/app/_lib/caller";
import { imports } from "@/app/_lib/imports";
import { importsRoute } from "@/app/_lib/imports-route";
import { transactions } from "@/app/_lib/transactions";
import { rules } from "@/app/_lib/rules";
import { householdMembers, transfers } from "@/app/_lib/transfers";

export const { GET, POST } = importsRoute({
  imports,
  accounts,
  transactions,
  getCaller,
  applyRules: (caller, bookingIds) => rules.applyToBookings(caller, bookingIds),
  afterImport: async (caller, bookingIds, ruleTransfers) =>
    transfers.matchAfterImport(caller, { bookingIds, members: await householdMembers(caller), ruleTransfers }),
});
