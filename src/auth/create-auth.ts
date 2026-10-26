import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import { headers } from "next/headers";
import type { Auth, Inviter } from "./contract";
import { findOrCreateUser, IDENTITY_SIGN_IN_PATH, safeCallbackPath, zeroTrust, type LoginMode } from "./identity/plugin";
import { createIdentityVerifier, type IdentityOptions } from "./identity/verify";
import { invites } from "./invite/plugin";
import { authTables } from "./schema";

// A Drizzle Postgres database (node-postgres, PGlite, ...). Typed loosely so host projects
// can pass whichever Drizzle driver they use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDatabase = { [key: string]: any };

/** How people sign in. There is no email and password. */
export type AuthMode =
  /** A zero-trust proxy (Cloudflare Access, ...) signs people in; the app checks its signed token. */
  | ({ kind: "identity"; /** Where sign-out leads, to end the provider's login too. */ logoutUrl: string } & IdentityOptions)
  /** Local development only: sign in as any email. See assertDevAllowed. */
  | { kind: "dev" };

export type AuthOptions = {
  db: DrizzleDatabase;
  /** Signs session cookies. At least 32 random characters. */
  secret: string;
  /** Public address of the app, e.g. https://haushalt.example. */
  baseURL: string;
  mode: AuthMode;
  /** Path of the page that receives invite links. Default: /invite */
  invitePath?: string;
  /** How long an invite link stays valid. Default: 7 days. */
  inviteTtlSeconds?: number;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Dev sign-in lets anyone sign in as anyone, so it is refused unless the app runs under `next dev`
 * (or tests) on a local address. Forgetting a setting can never turn it on on a server.
 */
export function assertDevAllowed(nodeEnv: string | undefined, baseURL: string): void {
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    throw new Error("Dev sign-in needs NODE_ENV=development (next dev). Use AUTH_MODE=identity.");
  }
  const host = new URL(baseURL).hostname;
  if (!LOCAL_HOSTS.has(host) && !host.endsWith(".localhost")) {
    throw new Error("Dev sign-in needs BETTER_AUTH_URL on localhost. Use AUTH_MODE=identity.");
  }
}

function loginMode(options: AuthOptions): LoginMode {
  if (options.mode.kind === "dev") {
    assertDevAllowed(process.env.NODE_ENV, options.baseURL);
    return { kind: "dev" };
  }
  return { kind: "identity", verify: createIdentityVerifier(options.mode) };
}

export function buildBetterAuth(options: AuthOptions, mode: LoginMode = loginMode(options)) {
  const invitePath = options.invitePath ?? "/invite";
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    database: drizzleAdapter(options.db, { provider: "pg", schema: authTables, transaction: true }),
    plugins: [
      zeroTrust(mode),
      invites({
        buildInviteUrl: (token) => new URL(`${invitePath}/${token}`, options.baseURL).toString(),
        ttlSeconds: options.inviteTtlSeconds,
      }),
      nextCookies(), // must stay last
    ],
  });
}

export type BetterAuthInstance = ReturnType<typeof buildBetterAuth>;

/** Display names of the given users (id → name). Unknown ids are left out. */
export async function findUserNames(auth: BetterAuthInstance, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { adapter } = await auth.$context;
  const users = await adapter.findMany<{ id: string; name: string }>({
    model: "user",
    where: [{ field: "id", operator: "in", value: unique }],
  });
  return new Map(users.map((user) => [user.id, user.name]));
}

/** Whether a user with this email exists (emails are stored in lower case). */
export async function hasUserWithEmail(auth: BetterAuthInstance, email: string): Promise<boolean> {
  const { adapter } = await auth.$context;
  const user = await adapter.findOne<{ id: string }>({
    model: "user",
    where: [{ field: "email", value: email.trim().toLowerCase() }],
  });
  return user !== null;
}

/** Who invited `userId` most recently, or null. */
export async function findInviter(auth: BetterAuthInstance, userId: string): Promise<Inviter | null> {
  const { adapter } = await auth.$context;
  const user = await adapter.findOne<{ invitedById: string | null; invitedAt: Date | null }>({
    model: "user",
    where: [{ field: "id", value: userId }],
  });
  if (!user?.invitedById) return null;
  const inviter = await adapter.findOne<{ id: string; name: string }>({
    model: "user",
    where: [{ field: "id", value: user.invitedById }],
  });
  if (!inviter) return null;
  return { id: inviter.id, name: inviter.name, invitedAt: new Date(user.invitedAt ?? 0) };
}

/** A session for the user with this email (created if new). Server only, e.g. for the dev seed. */
export async function ensureUserSession(auth: BetterAuthInstance, input: { email: string; name: string }) {
  const { internalAdapter } = await auth.$context;
  const user = await findOrCreateUser(internalAdapter, { email: input.email.trim().toLowerCase(), name: input.name }, "dev");
  const session = await internalAdapter.createSession(user.id);
  return { userId: user.id, sessionToken: session.token };
}

/**
 * The session of a request, or null. Zero trust: in identity mode it counts only while the
 * provider's token belongs to the same person, so another person in the same browser never gets it.
 */
export async function sessionForRequest(auth: BetterAuthInstance, mode: LoginMode, requestHeaders: Headers) {
  let session;
  try {
    session = await auth.api.getSession({ headers: requestHeaders });
  } catch (error) {
    // The identity check before every auth endpoint refuses requests without a matching token.
    if (error instanceof APIError && error.statusCode === 401) return null;
    throw error;
  }
  if (!session || mode.kind === "dev") return session;
  const identity = await mode.verify(requestHeaders);
  if (!identity || identity.email !== session.user.email.toLowerCase()) return null;
  return session;
}

/** The auth instance for a Next.js app: route handler plus session helpers for server code. */
export function createAuth(options: AuthOptions): Auth {
  const mode = loginMode(options);
  const auth = buildBetterAuth(options, mode);
  const { GET, POST } = toNextJsHandler(auth);

  async function getSession() {
    return sessionForRequest(auth, mode, await headers());
  }

  return {
    handler: { GET, POST },
    mode: mode.kind,
    getSession,
    signInUrl(callbackPath = "/") {
      const query = new URLSearchParams({ callbackURL: safeCallbackPath(callbackPath) });
      return `/api/auth${IDENTITY_SIGN_IN_PATH}?${query}`;
    },
    signOutRedirect: options.mode.kind === "identity" ? options.mode.logoutUrl : "/sign-in",
    async devSignIn(input: { email: string; name?: string }) {
      if (mode.kind !== "dev") throw new Error("Dev sign-in is off");
      await auth.api.devSignIn({ body: input, headers: await headers() });
    },
    getInviter: (userId: string) => findInviter(auth, userId),
    getUserNames: (ids: readonly string[]) => findUserNames(auth, ids),
    userExists: (email: string) => hasUserWithEmail(auth, email),
    ensureUserSession: (input: { email: string; name: string }) => ensureUserSession(auth, input),
  };
}

