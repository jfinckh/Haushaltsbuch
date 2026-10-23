import { z } from "zod";
import { germanAmountSchema } from "@/shared/money";

// Input of budgets, shared by the form (client) and the service (server). Messages are translation
// keys; the form translates them.

/** A monthly limit as German amount text ("400,00"); becomes cents, must be above zero. */
const limitSchema = germanAmountSchema.refine((cents) => cents > 0, "budgets.validation.limitPositive");

/**
 * A new budget: account, expense category (group or subcategory key, standard or own) and monthly
 * limit. Whether the category fits the account is the service's check (transactions' checkCategory).
 */
export const createBudgetSchema = z.object({
  accountId: z.string().min(1).max(100),
  category: z.string({ message: "budgets.validation.categoryRequired" }).min(1, "budgets.validation.categoryRequired").max(100),
  limit: limitSchema,
});

/** A change of a budget: only its limit. */
export const updateBudgetSchema = z.object({ limit: limitSchema });

/** A calendar month written as YYYY-MM; missing means the current month. */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .optional();
