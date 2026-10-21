import "server-only";
import { db } from "@/db/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import { createTransfers } from "@/transfers/server";
import { auth } from "./auth";
import { requireEnv } from "./env";
import { households } from "./households";
import { householdMembersOf } from "./members";
import { transactions } from "./transactions";

export const transfers = createTransfers({
  db,
  crypto: createFieldCrypto({ keys: requireEnv("FIELD_ENCRYPTION_KEYS"), indexKey: requireEnv("BLIND_INDEX_KEY") }),
  transactions,
});

/** The caller's household members with names. */
export const householdMembers = householdMembersOf({
  listMembers: (caller) => households.listMembers(caller),
  getUserNames: (ids) => auth.getUserNames(ids),
});
