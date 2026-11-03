import "server-only";
import { db } from "@/db/server";
import { createRecurring, createRecurringRunner } from "@/recurring/server";
import { transactions } from "./transactions";

export const recurringRunner = createRecurringRunner({ db });

export const recurring = createRecurring({ db, transactions });
