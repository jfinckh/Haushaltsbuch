import { z } from "zod";
import { germanAmountSchema } from "@/shared/money";
import { isValidIban, normalizeIban } from "@/shared/iban";

// Shared by the form (client) and the API routes (server). Messages are translation keys; the
// form translates them, as it does the bank, type and role names (accounts messages).

export const BANKS = ["ing", "trade_republic", "cash", "other"] as const;
export const ACCOUNT_TYPES = ["checking", "savings", "clearing", "depot", "cash"] as const;
export const ACCOUNT_ROLES = ["everyday", "savings"] as const;
export const VISIBILITIES = ["private", "shared"] as const;

export type Bank = (typeof BANKS)[number];
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export type Visibility = (typeof VISIBILITIES)[number];

/** The account types each bank offers. */
export const TYPES_BY_BANK: Record<Bank, readonly AccountType[]> = {
  ing: ["checking", "savings", "depot"],
  trade_republic: ["clearing", "depot"],
  cash: ["cash"],
  other: ["checking", "savings", "depot"],
};

/** The role an account type usually has: money moved to a savings account counts as saving. */
export function defaultRole(type: AccountType): AccountRole {
  return type === "savings" || type === "depot" ? "savings" : "everyday";
}

const nameSchema = z.string().trim().min(1, "accounts.validation.nameRequired").max(60, "accounts.validation.nameTooLong");

/** An optional IBAN as typed: spaces and case do not matter, empty means none. */
const ibanSchema = z
  .string()
  .transform(normalizeIban)
  .refine((iban) => iban === "" || isValidIban(iban), "accounts.validation.ibanInvalid")
  .transform((iban) => iban || null)
  .nullable();

/** A complete account, after parsing. Also used to check an account after an update. */
export const accountValuesSchema = z
  .object({
    name: nameSchema,
    bank: z.enum(BANKS),
    type: z.enum(ACCOUNT_TYPES),
    role: z.enum(ACCOUNT_ROLES),
    visibility: z.enum(VISIBILITIES),
    openingBalanceCents: z.number().int().refine(Number.isSafeInteger),
    iban: z.string().refine(isValidIban).nullable(),
  })
  .superRefine((account, ctx) => {
    if (!TYPES_BY_BANK[account.bank].includes(account.type)) {
      ctx.addIssue({ code: "custom", path: ["type"], message: "accounts.validation.typeNotAtBank" });
    }
    if (account.bank === "cash" && account.iban) {
      ctx.addIssue({ code: "custom", path: ["iban"], message: "accounts.validation.cashHasNoIban" });
    }
  });

export type AccountValues = z.infer<typeof accountValuesSchema>;

/** One new account, as the form sends it (amount as German text). */
export const createAccountSchema = z
  .object({
    name: nameSchema,
    bank: z.enum(BANKS),
    type: z.enum(ACCOUNT_TYPES),
    role: z.enum(ACCOUNT_ROLES).optional(),
    visibility: z.enum(VISIBILITIES),
    openingBalance: germanAmountSchema,
    iban: ibanSchema.optional(),
  })
  .transform(({ openingBalance, role, iban, ...account }) => ({
    ...account,
    role: role ?? defaultRole(account.type),
    openingBalanceCents: openingBalance,
    iban: iban ?? null,
  }))
  .pipe(accountValuesSchema);

/** Trade Republic: the clearing account (everyday, with the IBAN) and the depot (savings) at once. */
export const createTradeRepublicSchema = z.object({
  setup: z.literal("trade-republic"),
  visibility: z.enum(VISIBILITIES),
  iban: ibanSchema.optional(),
  clearingOpeningBalance: germanAmountSchema,
  depotOpeningBalance: germanAmountSchema,
});

export type CreateTradeRepublicInput = z.infer<typeof createTradeRepublicSchema>;

/** Changes to an account; omitted fields stay. `iban: null` or "" removes the IBAN. */
export const updateAccountSchema = z.object({
  name: nameSchema.optional(),
  bank: z.enum(BANKS).optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  role: z.enum(ACCOUNT_ROLES).optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  openingBalance: germanAmountSchema.optional(),
  iban: ibanSchema.optional(),
  archived: z.boolean().optional(),
});

export type UpdateAccountInput = z.input<typeof updateAccountSchema>;
