import { getCaller } from "@/app/_lib/caller";
import { transactions } from "@/app/_lib/transactions";
import { transactionRoute } from "@/app/_lib/transactions-route";
import { rules } from "@/app/_lib/rules";
import { transfers } from "@/app/_lib/transfers";

export const { GET, PATCH, DELETE } = transactionRoute({ transactions, transfers, rules, getCaller });
