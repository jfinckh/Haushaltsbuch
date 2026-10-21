import "server-only";
import { db } from "@/db/server";
import { createImports } from "@/import/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import { requireEnv } from "./env";
import { transactions } from "./transactions";

export const imports = createImports({
  db,
  crypto: createFieldCrypto({ keys: requireEnv("FIELD_ENCRYPTION_KEYS"), indexKey: requireEnv("BLIND_INDEX_KEY") }),
  transactions,
});
