import { accounts } from "@/app/_lib/accounts";
import { accountsRoute } from "@/app/_lib/accounts-route";
import { getCaller } from "@/app/_lib/caller";

export const { GET, POST } = accountsRoute({ accounts, getCaller });
