/** Roles are stored comma-separated by better-auth's admin plugin ("admin,user"). */
export function hasRole(user: { role?: string | null } | null | undefined, role: string) {
  return (user?.role ?? "")
    .split(",")
    .map((r) => r.trim())
    .includes(role);
}
