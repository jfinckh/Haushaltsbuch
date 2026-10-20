/**
 * Proxy entry point (Next.js `proxy.ts`). It only checks whether a session
 * cookie exists, which is fast but not a security check: pages, server
 * actions and route handlers must still call `requireSession()`.
 */
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { defaultAuthRoutes } from "./core/types";

export interface AuthProxyOptions {
  /** Paths that don't need a session. Prefix match: "/sign-in" covers "/sign-in/x". */
  publicPaths?: string[];
  signInPath?: string;
}

export function isPublicPath(pathname: string, publicPaths: string[]) {
  return publicPaths.some((p) =>
    p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`),
  );
}

export const defaultPublicPaths = [
  defaultAuthRoutes.signIn,
  defaultAuthRoutes.signUp,
  defaultAuthRoutes.forgotPassword,
  defaultAuthRoutes.resetPassword,
  defaultAuthRoutes.twoFactor,
  "/api/auth",
];

export function createAuthProxy(options: AuthProxyOptions = {}) {
  const publicPaths = options.publicPaths ?? defaultPublicPaths;
  const signInPath = options.signInPath ?? defaultAuthRoutes.signIn;

  return function authProxy(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    if (isPublicPath(pathname, publicPaths)) return NextResponse.next();
    if (getSessionCookie(request)) return NextResponse.next();

    const url = new URL(signInPath, request.url);
    const target = pathname + search;
    if (target !== "/") url.searchParams.set("redirectTo", target);
    return NextResponse.redirect(url);
  };
}
