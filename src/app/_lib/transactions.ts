import "server-only";
import { db } from "@/db/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import { createTransactions } from "@/transactions/server";
import { requireEnv } from "./env";

export const transactions = createTransactions({
  db,
  crypto: createFieldCrypto({ keys: requireEnv("FIELD_ENCRYPTION_KEYS"), indexKey: requireEnv("BLIND_INDEX_KEY") }),
});
