// Booking types (docs/konzept.md): transfers and saving are neither income nor expense. Browser-safe.

export const TRANSACTION_KINDS = ["expense", "income", "transfer", "saving"] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** The type the form proposes for an amount: money out is an expense, money in is income. */
export function proposedKind(amountCents: number): TransactionKind {
  return amountCents < 0 ? "expense" : "income";
}
