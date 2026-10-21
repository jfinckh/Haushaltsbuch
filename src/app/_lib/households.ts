import "server-only";
import { db } from "@/db/server";
import { createHouseholds } from "@/households/server";
import { accounts } from "./accounts";

// households does not know accounts: the app tells it which households still hold shared accounts,
// so switching households never drops them.
export const households = createHouseholds({ db, householdHoldsData: accounts.householdHasSharedAccounts });
