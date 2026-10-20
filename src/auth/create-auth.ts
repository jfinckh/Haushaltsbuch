import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { invites } from "./invite/plugin";
import { authTables } from "./schema";
import { signInSchema, signUpSchema } from "./validation";

// A Drizzle Postgres database (node-postgres, PGlite, ...). Typed loosely so host projects
// can pass whichever Drizzle driver they use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDatabase = { [key: string]: any };

export type AuthOptions = {
  db: DrizzleDatabase;
  /** Signs session cookies. At least 32 random characters. */
  secret: string;
  /** Public address of the app, e.g. https://haushalt.example. */
  baseURL: string;
  /** Path of the page that receives invite links. Default: /invite */
  invitePath?: string;
  /** How long an invite link stays valid. Default: 7 days. */
  inviteTtlSeconds?: number;
};

const bodySchemas: Record<string, typeof signInSchema | typeof signUpSchema> = {
  "/sign-in/email": signInSchema,
  "/sign-up/email": signUpSchema,
};

export function buildBetterAuth(options: AuthOptions) {
  const invitePath = options.invitePath ?? "/invite";
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    database: drizzleAdapter(options.db, { provider: "pg", schema: authTables, transaction: true }),
    emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 8, maxPasswordLength: 128 },
    hooks: {
      // Same input rules as the forms.
      before: createAuthMiddleware(async (ctx) => {
        const schema = bodySchemas[ctx.path];
        if (!schema) return;
        const result = schema.safeParse(ctx.body);
        if (!result.success) {
          throw new APIError("BAD_REQUEST", { message: result.error.issues[0]?.message ?? "Invalid input" });
        }
      }),
    },
    plugins: [
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

export type Inviter = {
  id: string;
  name: string;
  /** When the user accepted this inviter's invite. Tells a newer invite from an older one. */
  invitedAt: Date;
};

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

/** The auth instance for a Next.js app: route handler plus session helpers for server code. */
export function createAuth(options: AuthOptions) {
  const auth = buildBetterAuth(options);
  const { GET, POST } = toNextJsHandler(auth);

  async function getSession() {
    return auth.api.getSession({ headers: await headers() });
  }

  return {
    /** Mount at app/api/auth/[...all]/route.ts: `export const { GET, POST } = auth.handler`. */
    handler: { GET, POST },
    api: auth.api,
    /** The signed-in user and session, or null. Reads request headers, so call it inside <Suspense>. */
    getSession,
    /** Like getSession, but redirects to `redirectTo` when nobody is signed in. */
    async requireSession(redirectTo = "/sign-in") {
      const session = await getSession();
      if (!session) redirect(redirectTo);
      return session;
    },
    /** Who invited `userId` most recently and when they accepted, or null. */
    getInviter: (userId: string) => findInviter(auth, userId),
    /**
     * Display names of the given users (id → name). Server only: callers decide whose names
     * a user may see and pass only those ids.
     */
    getUserNames: (ids: readonly string[]) => findUserNames(auth, ids),
  };
}

export type Auth = ReturnType<typeof createAuth>;
