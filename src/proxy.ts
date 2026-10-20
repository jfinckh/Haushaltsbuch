import { createAuthProxy } from "@/auth/proxy";

// Sends visitors without a session cookie to the sign-in page. Pages still
// check the session themselves; this only saves a round trip.
export const proxy = createAuthProxy();

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
