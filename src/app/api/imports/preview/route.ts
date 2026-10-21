import { accounts } from "@/app/_lib/accounts";
import { getCaller } from "@/app/_lib/caller";
import { imports } from "@/app/_lib/imports";
import { importPreviewRoute } from "@/app/_lib/imports-route";
import { transactions } from "@/app/_lib/transactions";

export const { POST } = importPreviewRoute({ imports, accounts, transactions, getCaller });
