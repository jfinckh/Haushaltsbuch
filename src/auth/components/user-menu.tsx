"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth, useSession } from "../client/provider";
import { hasRole } from "../core/roles";
import { ADMIN_ROLE } from "../core/types";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function SignOutButton({ className = "btn btn-ghost", children }: { className?: string; children?: ReactNode }) {
  const { client, routes, messages: m } = useAuth();
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await client.signOut();
        router.push(routes.afterSignOut);
        router.refresh();
      }}
    >
      {children ?? m.userMenu.signOut}
    </button>
  );
}

/** Avatar with a dropdown: account settings, admin (for admins), sign out. */
export function UserMenu({ children }: { children?: ReactNode }) {
  const { routes, messages: m } = useAuth();
  const { data, isPending } = useSession();

  if (isPending) return <span className="loading loading-spinner loading-sm" />;
  if (!data) {
    return (
      <Link href={routes.signIn} className="btn btn-primary btn-sm">
        {m.signIn.submit}
      </Link>
    );
  }

  const { user } = data;
  return (
    <div className="dropdown dropdown-end">
      <div tabIndex={0} role="button" className="btn btn-ghost btn-circle avatar avatar-placeholder">
        <div className="bg-neutral text-neutral-content w-10 rounded-full">
          <span>{initials(user.name || user.email)}</span>
        </div>
      </div>
      <ul tabIndex={0} className="menu dropdown-content bg-base-100 rounded-box z-10 mt-3 w-60 p-2 shadow">
        <li className="menu-title">
          <span className="truncate">{user.name}</span>
          <span className="truncate font-normal">{user.email}</span>
        </li>
        <li>
          <Link href={routes.account}>{m.userMenu.account}</Link>
        </li>
        {hasRole(user, ADMIN_ROLE) && (
          <li>
            <Link href={routes.admin}>{m.userMenu.admin}</Link>
          </li>
        )}
        {children}
        <li>
          <SignOutButton className="" />
        </li>
      </ul>
    </div>
  );
}

/**
 * Client-side visibility helpers. They only hide UI; protect data on the
 * server with requireSession() / requireRole().
 */
export function SignedIn({ children }: { children: ReactNode }) {
  const { data } = useSession();
  return data ? <>{children}</> : null;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { data, isPending } = useSession();
  return !isPending && !data ? <>{children}</> : null;
}

export function ShowForRole({ role, children }: { role: string; children: ReactNode }) {
  const { data } = useSession();
  return data && hasRole(data.user, role) ? <>{children}</> : null;
}
