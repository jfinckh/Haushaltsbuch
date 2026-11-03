import { z } from "zod";

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
