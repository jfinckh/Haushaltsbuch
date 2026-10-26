// The contract of the auth part. createAuth implements it. It names its own types, so callers
// never depend on the login library behind it.

/** A signed-in user and their session, as the app reads them. */
export type AuthSession = {
  user: { id: string; name: string; email: string };
  session: { token: string };
};

export type Inviter = {
  id: string;
  name: string;
  /** When the user accepted this inviter's invite. Tells a newer invite from an older one. */
  invitedAt: Date;
};

type RouteHandler = (request: Request) => Promise<Response>;

/** Sign-in, sessions and invites for a Next.js app. */
export interface Auth {
  /** Mount at app/api/auth/[...all]/route.ts: `export const { GET, POST } = auth.handler`. */
  handler: { GET: RouteHandler; POST: RouteHandler };

  /** "identity" (zero-trust provider) or "dev" (local sign-in). */
  mode: "identity" | "dev";

  /** The signed-in user and session, or null. Reads request headers, so call it inside <Suspense>. */
  getSession(): Promise<AuthSession | null>;

  /** Identity mode: the address that starts a session from the provider's token, then goes to `callbackPath`. */
  signInUrl(callbackPath?: string): string;

  /** Where sign-out leads: the provider's logout (identity), else the sign-in page. */
  signOutRedirect: string;

  /** Dev mode: signs in as `email` and sets the session cookie. Call it from a server action. */
  devSignIn(input: { email: string; name?: string }): Promise<void>;

  /** Who invited `userId` most recently and when they accepted, or null. */
  getInviter(userId: string): Promise<Inviter | null>;

  /**
   * Display names of the given users (id → name). Server only: callers decide whose names
   * a user may see and pass only those ids.
   */
  getUserNames(ids: readonly string[]): Promise<Map<string, string>>;

  /** Whether a user with this email exists. Server only, e.g. for the dev seed. */
  userExists(email: string): Promise<boolean>;

  /** A session for the user with this email (created if new). Server only, for the dev seed. */
  ensureUserSession(input: { email: string; name: string }): Promise<{ userId: string; sessionToken: string }>;
}
