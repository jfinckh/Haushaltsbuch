/** Current balance per account (cents): opening balance plus the sum of its bookings. */
export function currentBalances(
  accounts: { id: string; openingBalanceCents: number }[],
  bookingSums: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(accounts.map((a) => [a.id, a.openingBalanceCents + (bookingSums[a.id] ?? 0)]));
}
