import "server-only";
import { db } from "@/db/server";
import { createHouseholds } from "@/households/server";

export const households = createHouseholds({ db });
