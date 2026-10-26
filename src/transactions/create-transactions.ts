import type { FieldCrypto } from "@/shared/field-crypto";
import type { RlsDatabase } from "@/shared/rls";
import { createBookingCodec } from "./booking-codec";
import { createBookingFigures } from "./booking-figures";
import { createBookingService } from "./booking-service";
import { createBookingStore } from "./booking-store";
import type { Transactions } from "./contract";
import { today as localToday } from "./months";

export type TransactionsOptions = {
  db: RlsDatabase;
  /** Encrypts counterparty, IBAN and reference; keys come from the environment. */
  crypto: FieldCrypto;
  /** Today's date (YYYY-MM-DD) for the default month. Default: the local date. */
  today?: () => string;
};

/** The transactions part. Every call is about the caller's own view; their user id comes from the database. */
export function createTransactions({ db, crypto, today = localToday }: TransactionsOptions): Transactions {
  const codec = createBookingCodec(crypto);
  return {
    ...createBookingService({ db, codec, today }),
    ...createBookingStore({ codec, today }),
    ...createBookingFigures({ db, today }),
  };
}
