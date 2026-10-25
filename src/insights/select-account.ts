type SwitcherAccount = { id: string; archived: boolean; visibility: "private" | "shared" };

/** The address value of the combined view "Alle privaten Konten". */
export const ALL_MINE = "all";

/**
 * Whether the switcher offers "Alle privaten Konten": only with two or more active private accounts.
 * The list holds only accounts the caller may see, so every private one is the caller's own.
 */
export function offersAllMine(accounts: SwitcherAccount[]): boolean {
  return accounts.filter((a) => !a.archived && a.visibility === "private").length >= 2;
}

/**
 * The dashboard's choice: "all" (Alle privaten Konten) or the active account named in the address.
 * Otherwise "all" when it is offered, else the first active account. Another member's private id is
 * not in the list, so it falls back silently.
 */
export function selectAccount<T extends SwitcherAccount>(accounts: T[], id: string | undefined): T | typeof ALL_MINE | null {
  const active = accounts.filter((a) => !a.archived);
  const named = active.find((a) => a.id === id);
  if (named) return named;
  if (offersAllMine(accounts)) return ALL_MINE;
  return active[0] ?? null;
}
