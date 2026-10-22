import "server-only";
import { db } from "@/db/server";
import { createRules } from "@/rules/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import { requireEnv } from "./env";
import { transactions } from "./transactions";

export const rules = createRules({
  db,
  crypto: createFieldCrypto({ keys: requireEnv("FIELD_ENCRYPTION_KEYS"), indexKey: requireEnv("BLIND_INDEX_KEY") }),
  transactions,
});
