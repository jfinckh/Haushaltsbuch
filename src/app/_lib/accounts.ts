import "server-only";
import { createAccounts } from "@/accounts/server";
import { db } from "@/db/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import { requireEnv } from "./env";

export const accounts = createAccounts({
  db,
  crypto: createFieldCrypto({ keys: requireEnv("FIELD_ENCRYPTION_KEYS"), indexKey: requireEnv("BLIND_INDEX_KEY") }),
});
