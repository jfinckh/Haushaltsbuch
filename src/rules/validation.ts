import { z } from "zod";
import { isCategoryFor, isOwnCategoryKey, TRANSACTION_KINDS } from "@/transactions";

// Input of rules, learning and applying, shared by the forms (client) and the service (server).
// Messages are translation keys; the forms translate them.

const id = z.string().min(1).max(100);

/** A pattern: trimmed, whitespace collapsed; empty means no condition. */
const optionalPattern = z
  .string()
  .nullish()
  .transform((value) => (value ?? "").trim().replace(/\s+/g, " "))
  .pipe(z.string().max(200, "rules.validation.patternTooLong"))
  .transform((value) => value || null);

export const ruleScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("account"), accountId: id }),
  z.object({ type: z.literal("shared") }),
  z.object({ type: z.literal("private") }),
]);

/** A rule as the form sends it, also for changes (the whole rule). */
export const ruleInputSchema = z
  .object({
    scope: ruleScopeSchema,
    counterparty: optionalPattern,
    reference: optionalPattern,
    amountSign: z
      .enum(["negative", "positive"])
      .nullish()
      .or(z.literal(""))
      .transform((value) => value || null),
    kind: z.enum(TRANSACTION_KINDS),
    category: z
      .string()
      .max(100)
      .nullish()
      .transform((value) => value || null),
    transferTarget: z
      .enum(["external"])
      .nullish()
      .or(z.literal(""))
      .transform((value) => value || null),
  })
  .superRefine((rule, ctx) => {
    if (rule.counterparty === null && rule.reference === null) {
      ctx.addIssue({ code: "custom", path: ["counterparty"], message: "rules.validation.patternRequired" });
    }
    // An own category's key is only checked for its format here; the service checks it against the scope.
    const own = rule.category !== null && isOwnCategoryKey(rule.category) && (rule.kind === "expense" || rule.kind === "income");
    if (rule.category !== null && !own && !isCategoryFor(rule.kind, rule.category)) {
      ctx.addIssue({ code: "custom", path: ["category"], message: "rules.validation.categoryNotForKind" });
    }
    if (rule.transferTarget !== null && rule.kind !== "transfer" && rule.kind !== "saving") {
      ctx.addIssue({ code: "custom", path: ["transferTarget"], message: "rules.validation.targetNotForKind" });
    }
  });

export type RuleInput = z.input<typeof ruleInputSchema>;
export type RuleValues = z.output<typeof ruleInputSchema>;

/** "Künftig immer so": which text of the booking the new rule looks for. */
export const learnRuleSchema = z.object({
  field: z.enum(["counterparty", "reference"]),
  pattern: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(1, "rules.validation.patternRequired").max(200, "rules.validation.patternTooLong")),
});

export type LearnRule = z.output<typeof learnRuleSchema>;

export const applyRulesSchema = z.object({ accountId: id });

/** "Nicht mehr vorschlagen": which suggestion the member hides. */
export const dismissSuggestionSchema = learnRuleSchema;

export type DismissSuggestion = z.output<typeof dismissSuggestionSchema>;
