import "server-only";
import { db } from "@/db/server";
import { createRecurring, createRecurringRunner } from "@/recurring/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import { requireEnv } from "./env";
import { imports } from "./imports";
import { transactions } from "./transactions";

export const recurringRunner = createRecurringRunner({ db });

export const recurring = createRecurring({
  db,
  transactions,
  // Suggestions only from bookings entered by hand: imported ones are left out.
  importedBookingIds: imports.importedBookingIds,
  crypto: createFieldCrypto({ keys: requireEnv("FIELD_ENCRYPTION_KEYS"), indexKey: requireEnv("BLIND_INDEX_KEY") }),
});
