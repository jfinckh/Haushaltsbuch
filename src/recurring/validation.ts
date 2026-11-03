import { z } from "zod";
import { isValidIban, normalizeIban } from "@/shared/iban";
import { parseGermanAmount } from "@/shared/money";

// Input checks of the recurring part, shared by the booking form and the routes. Messages are
// translation keys (recurring.validation.*). Browser-safe.

export const INTERVAL_MONTHS = [1, 3, 6, 12] as const;

export type IntervalMonths = (typeof INTERVAL_MONTHS)[number];

/** Whether `value` is a real calendar date written as YYYY-MM-DD. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** How a new booking repeats: every 1, 3, 6 or 12 months, optionally until a last day (inclusive). */
export const repeatSchema = z.object({
  intervalMonths: z.union(INTERVAL_MONTHS.map((n) => z.literal(n)) as [z.ZodLiteral<1>, z.ZodLiteral<3>, z.ZodLiteral<6>, z.ZodLiteral<12>], {
    message: "recurring.validation.intervalInvalid",
  }),
  endDate: z.string().refine(isIsoDate, "recurring.validation.endDateInvalid").nullable(),
});

export type RepeatValues = z.infer<typeof repeatSchema>;

/** What can be done with a template from the list. */
export const templateActionSchema = z.object({ action: z.enum(["pause", "resume", "end"]) });

export type TemplateAction = z.infer<typeof templateActionSchema>["action"];

const KINDS = ["expense", "income", "transfer", "saving"] as const;

/** Optional text: trimmed, empty means none. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "recurring.validation.textTooLong")
    .nullish()
    .transform((value) => value || null);

/**
 * A template from the template form (create and edit). The amount comes in German format; the next
 * date sets the day of the month. "Not before today" needs today and is checked by the service.
 */
export const templateInputSchema = z
  .object({
    accountId: z.string().min(1, "recurring.validation.accountRequired"),
    amount: z
      .string()
      .transform((value) => parseGermanAmount(value))
      .refine((cents): cents is number => cents !== null && cents !== 0, "recurring.validation.amountInvalid"),
    kind: z.enum(KINDS),
    category: z
      .string()
      .nullish()
      .transform((value) => value || null),
    counterparty: optionalText(200),
    counterpartyIban: z
      .string()
      .nullish()
      .transform((value) => normalizeIban(value ?? ""))
      .refine((iban) => iban === "" || isValidIban(iban), "recurring.validation.ibanInvalid")
      .transform((iban) => iban || null),
    reference: optionalText(500),
    countsNextMonth: z.boolean().nullish().transform((value) => value ?? null),
    intervalMonths: repeatSchema.shape.intervalMonths,
    nextDueDate: z.string().refine(isIsoDate, "recurring.validation.dateInvalid"),
    endDate: repeatSchema.shape.endDate.optional().transform((value) => value ?? null),
  })
  .superRefine((values, ctx) => {
    if (values.category !== null && values.kind !== "expense" && values.kind !== "income") {
      ctx.addIssue({ code: "custom", path: ["category"], message: "recurring.validation.categoryNotForKind" });
    }
    if (values.endDate !== null && values.endDate < values.nextDueDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "recurring.validation.endBeforeNext" });
    }
  })
  .transform(({ amount, ...rest }) => ({ ...rest, amountCents: amount as number }));

export type TemplateValues = z.infer<typeof templateInputSchema>;
