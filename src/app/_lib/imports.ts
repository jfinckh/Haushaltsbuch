import "server-only";
import { db } from "@/db/server";
import { createImports } from "@/import/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import { accounts } from "./accounts";
import { requireEnv } from "./env";
import { transactions } from "./transactions";

export const imports = createImports({
  db,
  crypto: createFieldCrypto({ keys: requireEnv("FIELD_ENCRYPTION_KEYS"), indexKey: requireEnv("BLIND_INDEX_KEY") }),
  transactions,
  // The opening balance of an empty account is set in the import's own database transaction.
  setOpeningBalance: accounts.setOpeningBalance,
});
