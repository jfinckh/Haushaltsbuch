import "server-only";
import type { FieldCrypto } from "@/shared/field-crypto";
import type { Bank } from "./parsing/types";

const CONTEXT = "import.fingerprint";

/**
 * The fingerprint of an imported row: a keyed hash (blind index) of the target account, the bank and
 * the row's dedup key. Without the key from the environment it reveals nothing about the booking.
 */
export function fingerprint(crypto: FieldCrypto, accountId: string, bank: Bank, dedupKey: string): string {
  return crypto.blindIndex(`${accountId}\n${bank}\n${dedupKey}`, CONTEXT);
}
