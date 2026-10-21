import { accounts } from "@/app/_lib/accounts";
import { getCaller } from "@/app/_lib/caller";
import { imports } from "@/app/_lib/imports";
import { importRoute } from "@/app/_lib/imports-route";
import { transactions } from "@/app/_lib/transactions";

export const { DELETE } = importRoute({ imports, accounts, transactions, getCaller });
