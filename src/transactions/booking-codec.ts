import type { FieldCrypto } from "@/shared/field-crypto";
import { formatIban } from "@/shared/iban";
import type { TransactionView } from "./contract";
import type { transaction } from "./schema";
import type { TransactionValues } from "./validation";

export type TransactionRow = typeof transaction.$inferSelect;

const CONTEXT = {
  counterparty: "transaction.counterparty",
  counterpartyIban: "transaction.counterpartyIban",
  reference: "transaction.reference",
} as const;

/** The encrypted columns of a booking, as stored. */
export type TransactionColumns = Omit<TransactionValues, "counterparty" | "counterpartyIban" | "reference"> & {
  counterpartyEncrypted: string | null;
  counterpartyIbanEncrypted: string | null;
  counterpartyIbanIndex: string | null;
  referenceEncrypted: string | null;
};

/** Turns stored rows into views and values, and values into encrypted columns. */
export interface BookingCodec {
  /** The booking as `userId` sees it. */
  toView(row: TransactionRow, userId: string): TransactionView;
  /** The booking's values, decrypted. */
  toValues(row: TransactionRow): TransactionValues;
  /** The stored columns for a booking's values, encrypted. */
  toColumns(values: TransactionValues): TransactionColumns;
}

export function createBookingCodec(fieldCrypto: FieldCrypto): BookingCodec {
  const decrypt = (value: string | null, context: string) => (value === null ? null : fieldCrypto.decrypt(value, context));
  const encrypt = (value: string | null, context: string) => (value === null ? null : fieldCrypto.encrypt(value, context));

  return {
    toView(row, userId) {
      const iban = decrypt(row.counterpartyIbanEncrypted, CONTEXT.counterpartyIban);
      return {
        id: row.id,
        accountId: row.accountId,
        date: row.bookingDate,
        amountCents: row.amountCents,
        kind: row.kind,
        category: row.category,
        counterparty: decrypt(row.counterpartyEncrypted, CONTEXT.counterparty),
        counterpartyIban: iban && formatIban(iban),
        reference: decrypt(row.referenceEncrypted, CONTEXT.reference),
        createdByMe: row.createdByUserId === userId,
        classifiedBy: row.classifiedBy,
      };
    },

    toValues(row) {
      return {
        accountId: row.accountId,
        bookingDate: row.bookingDate,
        amountCents: row.amountCents,
        kind: row.kind,
        category: row.category,
        counterparty: decrypt(row.counterpartyEncrypted, CONTEXT.counterparty),
        counterpartyIban: decrypt(row.counterpartyIbanEncrypted, CONTEXT.counterpartyIban),
        reference: decrypt(row.referenceEncrypted, CONTEXT.reference),
      };
    },

    toColumns({ counterparty, counterpartyIban, reference, ...plain }) {
      return {
        ...plain,
        counterpartyEncrypted: encrypt(counterparty, CONTEXT.counterparty),
        counterpartyIbanEncrypted: encrypt(counterpartyIban, CONTEXT.counterpartyIban),
        counterpartyIbanIndex: counterpartyIban && fieldCrypto.blindIndex(counterpartyIban, CONTEXT.counterpartyIban),
        referenceEncrypted: encrypt(reference, CONTEXT.reference),
      };
    },
  };
}

