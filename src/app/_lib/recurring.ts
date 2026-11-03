import "server-only";
import { db } from "@/db/server";
import { createRecurringRunner } from "@/recurring/server";

export const recurringRunner = createRecurringRunner({ db });
