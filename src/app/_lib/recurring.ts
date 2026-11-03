import "server-only";
import { db } from "@/db/server";
import { createRecurring, createRecurringRunner } from "@/recurring/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import { requireEnv } from "./env";
import { transactions } from "./transactions";

export const recurringRunner = createRecurringRunner({ db });

export const recurring = createRecurring({
  db,
  transactions,
  crypto: createFieldCrypto({ keys: requireEnv("FIELD_ENCRYPTION_KEYS"), indexKey: requireEnv("BLIND_INDEX_KEY") }),
});
