type Words = {
  /** The caller, e.g. "You". */
  you: string;
  /** The line when the caller is alone, e.g. "Only you so far". */
  onlyYou: string;
  /** Stands in for a member without a known name, e.g. "a member". */
  aMember: string;
};

/**
 * The member line of the household view, e.g. "You and Erika Test". `members` are the ids of
 * the caller's own household, `names` their display names from auth. `formatList` joins the
 * names in the UI language ("A, B and C" / "A, B und C").
 */
export function describeMembers(
  selfId: string,
  members: readonly string[],
  names: ReadonlyMap<string, string>,
  words: Words,
  formatList: (items: string[]) => string,
): string {
  const others = members.filter((id) => id !== selfId).map((id) => names.get(id) ?? words.aMember);
  if (others.length === 0) return words.onlyYou;
  return formatList([words.you, ...others]);
}
