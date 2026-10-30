import "server-only";
import { createInsights } from "@/insights/server";
import { transactions } from "./transactions";

export const insights = createInsights({ transactions });
