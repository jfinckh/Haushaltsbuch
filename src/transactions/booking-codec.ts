import type { FieldCrypto } from "@/shared/field-crypto";
import { formatIban, normalizeIban } from "@/shared/iban";
import type { BookingTexts, EncodedBookingTexts, TransactionView } from "./contract";
import { countingMonthOf } from "./counting-month";
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
  /** Texts encrypted like a booking's. */
  encodeTexts(texts: BookingTexts): EncodedBookingTexts;
  /** Texts decrypted; the IBAN formatted. */
  decodeTexts(columns: EncodedBookingTexts): BookingTexts;
}

export function createBookingCodec(fieldCrypto: FieldCrypto): BookingCodec {
  const decrypt = (value: string | null, context: string) => (value === null ? null : fieldCrypto.decrypt(value, context));
  const encrypt = (value: string | null, context: string) => (value === null ? null : fieldCrypto.encrypt(value, context));

  function encodeTexts({ counterparty, counterpartyIban, reference }: BookingTexts): EncodedBookingTexts {
    // Stored IBANs are compact and upper case (validation's ibanSchema), so the blind index matches.
    const iban = counterpartyIban && (normalizeIban(counterpartyIban) || null);
    return {
      counterpartyEncrypted: encrypt(counterparty, CONTEXT.counterparty),
      counterpartyIbanEncrypted: encrypt(iban, CONTEXT.counterpartyIban),
      counterpartyIbanIndex: iban && fieldCrypto.blindIndex(iban, CONTEXT.counterpartyIban),
      referenceEncrypted: encrypt(reference, CONTEXT.reference),
    };
  }

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
        countsNextMonth: row.countsNextMonth,
        countingMonth: countingMonthOf(row),
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
        countsNextMonth: row.countsNextMonth,
      };
    },

    toColumns({ counterparty, counterpartyIban, reference, ...plain }) {
      return { ...plain, ...encodeTexts({ counterparty, counterpartyIban, reference }) };
    },

    encodeTexts,

    decodeTexts(columns) {
      const iban = decrypt(columns.counterpartyIbanEncrypted, CONTEXT.counterpartyIban);
      return {
        counterparty: decrypt(columns.counterpartyEncrypted, CONTEXT.counterparty),
        counterpartyIban: iban && formatIban(iban),
        reference: decrypt(columns.referenceEncrypted, CONTEXT.reference),
      };
    },
  };
}

