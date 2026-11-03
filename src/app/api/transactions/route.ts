import { getCaller } from "@/app/_lib/caller";
import { recurring } from "@/app/_lib/recurring";
import { transactions } from "@/app/_lib/transactions";
import { transactionsRoute } from "@/app/_lib/transactions-route";

export const { GET, POST } = transactionsRoute({ transactions, recurring, getCaller });
