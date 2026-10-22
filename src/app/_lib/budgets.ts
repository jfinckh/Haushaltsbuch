import "server-only";
import { createBudgets } from "@/budgets/server";
import { db } from "@/db/server";
import { transactions } from "./transactions";

export const budgets = createBudgets({ db, transactions });
