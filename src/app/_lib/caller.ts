import "server-only";
import { redirect } from "next/navigation";
import type { Caller } from "@/shared/rls";
import { auth } from "./auth";

// The one place that turns the signed-in session into a Caller for the parts. The parts pass the
// session token to the database, which checks it and finds the user itself.

/** The signed-in caller, or null. Reads request headers, so call it inside <Suspense>. */
export async function getCaller(): Promise<Caller | null> {
  const session = await auth.getSession();
  return session ? { sessionToken: session.session.token } : null;
}

/** The signed-in user and their Caller; redirects to `redirectTo` when nobody is signed in. */
export async function requireCaller(redirectTo = "/sign-in") {
  const session = await auth.getSession();
  if (!session) redirect(redirectTo);
  const caller: Caller = { sessionToken: session.session.token };
  return { user: session.user, caller };
}
