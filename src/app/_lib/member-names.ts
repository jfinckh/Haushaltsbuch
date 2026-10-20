/**
 * The member line of the household view, e.g. "You and Erika Test". `members` are the ids of
 * the caller's own household, `names` their display names from auth.
 */
export function describeMembers(selfId: string, members: readonly string[], names: ReadonlyMap<string, string>): string {
  const others = members.filter((id) => id !== selfId).map((id) => names.get(id) ?? "a member");
  if (others.length === 0) return "Only you so far";
  const all = ["You", ...others];
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
}
