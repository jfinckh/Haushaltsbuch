import { accounts } from "@/app/_lib/accounts";
import { accountRoute } from "@/app/_lib/accounts-route";
import { getCaller } from "@/app/_lib/caller";

export const { GET, PATCH, DELETE } = accountRoute({ accounts, getCaller });
