import { z } from "zod";
import { isValidIban, normalizeIban } from "@/shared/iban";
import { germanAmountSchema } from "@/shared/money";
import { isCategoryFor } from "./categories";
import { TRANSACTION_KINDS } from "./kinds";
import { isMonth } from "./months";

// Shared by the form (client) and the API routes (server). Messages are translation keys; the form
// translates them.

/** Whether `value` is a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const dateSchema = z.string().refine(isIsoDate, "transactions.validation.dateInvalid");

const amountSchema = germanAmountSchema.refine((cents) => cents !== 0, "transactions.validation.amountZero");

/** Optional text: trimmed, empty means none. */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((value) => value || null);

const ibanSchema = z
  .string()
  .nullish()
  .transform((value) => normalizeIban(value ?? ""))
  .refine((iban) => iban === "" || isValidIban(iban), "transactions.validation.ibanInvalid")
  .transform((iban) => iban || null);

const categorySchema = z
  .string()
  .nullish()
  .transform((value) => value || null);

const fields = {
  accountId: z.string().min(1, "transactions.validation.accountRequired"),
  date: dateSchema,
  amount: amountSchema,
  kind: z.enum(TRANSACTION_KINDS),
  category: categorySchema,
  counterparty: optionalText(200, "transactions.validation.counterpartyTooLong"),
  counterpartyIban: ibanSchema,
  reference: optionalText(500, "transactions.validation.referenceTooLong"),
};

/** A complete booking as stored (before encryption). Also checks a booking after an update. */
export const transactionValuesSchema = z
  .object({
    accountId: z.string().min(1),
    bookingDate: dateSchema,
    amountCents: z.number().int().refine((cents) => cents !== 0 && Number.isSafeInteger(cents)),
    kind: z.enum(TRANSACTION_KINDS),
    category: z.string().nullable(),
    counterparty: z.string().max(200).nullable(),
    counterpartyIban: z.string().refine(isValidIban).nullable(),
    reference: z.string().max(500).nullable(),
  })
  .superRefine((values, ctx) => {
    if (values.category !== null && !isCategoryFor(values.kind, values.category)) {
      ctx.addIssue({ code: "custom", path: ["category"], message: "transactions.validation.categoryNotForKind" });
    }
  });

export type TransactionValues = z.infer<typeof transactionValuesSchema>;

/** A new booking, as the form sends it (amount as German text). */
export const createTransactionSchema = z
  .object(fields)
  .transform(({ date, amount, ...rest }) => ({ ...rest, bookingDate: date, amountCents: amount }))
  .pipe(transactionValuesSchema);

export type CreateTransactionInput = z.input<typeof createTransactionSchema>;

/** Changes to a booking; omitted fields stay. The merged booking is checked with transactionValuesSchema. */
export const updateTransactionSchema = z
  .object({
    accountId: fields.accountId.optional(),
    date: dateSchema.optional(),
    amount: amountSchema.optional(),
    kind: fields.kind.optional(),
    category: categorySchema.optional(),
    counterparty: fields.counterparty.optional(),
    counterpartyIban: fields.counterpartyIban.optional(),
    reference: fields.reference.optional(),
  })
  .transform(({ date, amount, ...rest }) => {
    // Absent fields come out as undefined; drop them so they do not overwrite stored values.
    const changes = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)) as Partial<TransactionValues>;
    if (date !== undefined) changes.bookingDate = date;
    if (amount !== undefined) changes.amountCents = amount;
    return changes;
  });

export type UpdateTransactionInput = z.input<typeof updateTransactionSchema>;

const optionalFilter = <T extends z.ZodType<string>>(schema: T) =>
  z.preprocess((value) => (value === "" || value === null ? undefined : value), schema.optional());

/** Which bookings of an account to list: a month, or from/to. Without any, the current month. */
export const listQuerySchema = z.object({
  accountId: z.string().min(1),
  month: optionalFilter(z.string().refine(isMonth)),
  from: optionalFilter(dateSchema),
  to: optionalFilter(dateSchema),
  kind: optionalFilter(z.enum(TRANSACTION_KINDS)),
  category: optionalFilter(z.string().max(100)),
  q: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() || undefined : value),
    z.string().max(100).optional(),
  ),
});

export type ListQuery = z.infer<typeof listQuerySchema>;
