import { toNextJsHandler } from "better-auth/next-js";
import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import { withRedirect } from "../core/redirect";
import { hasRole } from "../core/roles";
import {
  ADMIN_ROLE,
  defaultAuthRoutes,
  type AuthRoutes,
  type AuthUser,
} from "../core/types";
import type { Auth, AuthSession } from "./create-auth";

/** Strip the session down to what is safe to hand to client components. */
export function toAuthUser(session: AuthSession): AuthUser {
  const { user } = session;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    role: user.role,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

/**
 * Server-side checks for pages, layouts, server actions and route handlers.
 *
 * With Cache Components these read the request, so call them inside a
 * `<Suspense>` boundary, never at the top of a layout.
 */
export function createAuthServer(auth: Auth, routes: Partial<AuthRoutes> = {}) {
  const r = { ...defaultAuthRoutes, ...routes };

  /** The current session, or null. Deduplicated per request. */
  const getSession = cache(async (): Promise<AuthSession | null> => {
    return auth.api.getSession({ headers: await headers() });
  });

  /** The current session; redirects to the sign-in page when there is none. */
  async function requireSession(options: { redirectTo?: string } = {}) {
    const session = await getSession();
    if (!session) redirect(withRedirect(r.signIn, options.redirectTo));
    return session;
  }

  /** Like requireSession, and renders the 403 page when the role is missing. */
  async function requireRole(role: string, options: { redirectTo?: string } = {}) {
    const session = await requireSession(options);
    if (!hasRole(session.user, role)) forbidden();
    return session;
  }

  return {
    auth,
    routes: r,
    features: auth.features,
    getSession,
    requireSession,
    requireRole,
    requireAdmin: (options: { redirectTo?: string } = {}) => requireRole(ADMIN_ROLE, options),
    /** `export const { GET, POST } = authServer.handler` in app/api/auth/[...all]/route.ts */
    handler: toNextJsHandler(auth),
  };
}

export type AuthServer = ReturnType<typeof createAuthServer>;
