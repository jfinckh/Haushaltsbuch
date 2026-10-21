import { getCaller } from "@/app/_lib/caller";
import { transactions } from "@/app/_lib/transactions";
import { transactionRoute } from "@/app/_lib/transactions-route";

export const { GET, PATCH, DELETE } = transactionRoute({ transactions, getCaller });
