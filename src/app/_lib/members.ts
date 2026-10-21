import type { Caller } from "@/shared/rls";

type Deps = {
  /** Member ids of the caller's own household (households). */
  listMembers: (caller: Caller) => Promise<{ userId: string }[]>;
  /** Display names of the given users (auth). */
  getUserNames: (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
};

/**
 * The members of the caller's household with their names, for transfer matching and the pages.
 * Only ids of the caller's own household go to auth, so only their names come back.
 */
export function householdMembersOf({ listMembers, getUserNames }: Deps) {
  return async (caller: Caller): Promise<{ userId: string; name: string }[]> => {
    const ids = (await listMembers(caller)).map((member) => member.userId);
    const names = await getUserNames(ids);
    return ids.flatMap((userId) => {
      const name = names.get(userId);
      return name ? [{ userId, name }] : [];
    });
  };
}
