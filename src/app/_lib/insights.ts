import "server-only";
import { createInsights } from "@/insights/server";
import { transactions } from "./transactions";
import { transfers } from "./transfers";

export const insights = createInsights({ transactions, transfers });
