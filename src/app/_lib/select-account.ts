/**
 * The dashboard's account: the active one named in the address, else the first active one. The list
 * holds only accounts the caller may see, so another member's private id falls back silently.
 */
export function selectAccount<T extends { id: string; archived: boolean }>(accounts: T[], id: string | undefined): T | null {
  const active = accounts.filter((a) => !a.archived);
  return active.find((a) => a.id === id) ?? active[0] ?? null;
}
