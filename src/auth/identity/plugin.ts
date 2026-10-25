import type { BetterAuthPlugin, User } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { displayNameFor, type Identity, type IdentityVerifier } from "./verify";

// The only ways to sign in. In identity mode the zero-trust provider has already signed the person
// in; the app trusts its signed token, finds or creates the user and starts a normal Better Auth
// session. In dev mode (local only, see assertDevAllowed) a page signs in as any email.

export type LoginMode = { kind: "identity"; verify: IdentityVerifier } | { kind: "dev" };

export const IDENTITY_SIGN_IN_PATH = "/identity/sign-in";

type EndpointContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** The user with this email, or a new one. The name is only used for a new user. */
export async function findOrCreateUser(
  internalAdapter: EndpointContext["context"]["internalAdapter"],
  identity: Identity,
  method: "zero-trust" | "dev",
): Promise<User> {
  const found = await internalAdapter.findUserByEmail(identity.email);
  if (found) return found.user;
  return internalAdapter.createUser({ email: identity.email, name: displayNameFor(identity), emailVerified: true }, { method });
}

async function startSession(ctx: EndpointContext, identity: Identity, method: "zero-trust" | "dev") {
  const user = await findOrCreateUser(ctx.context.internalAdapter, identity, method);
  const session = await ctx.context.internalAdapter.createSession(user.id);
  await setSessionCookie(ctx, { session, user });
  return { user, session };
}

/** Only paths inside the app; anything else (other hosts, "//x", "/\x") leads to "/". */
export function safeCallbackPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

const devSignInBody = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(100).optional(),
});

const notFound = () => new APIError("NOT_FOUND");
const noIdentity = () => new APIError("UNAUTHORIZED", { message: "No valid identity token" });

/** Both endpoints always exist (so the API types stay the same); each answers 404 in the other mode. */
export const zeroTrust = (mode: LoginMode) =>
  ({
    id: "zero-trust",
    endpoints: {
      // Identity mode: the app's sign-in page redirects here. The provider has signed the person in already.
      identitySignIn: createAuthEndpoint(
        IDENTITY_SIGN_IN_PATH,
        { method: "GET", query: z.object({ callbackURL: z.string().max(2000).optional() }) },
        async (ctx) => {
          if (mode.kind !== "identity") throw notFound();
          const identity = ctx.headers ? await mode.verify(ctx.headers) : null;
          if (!identity) throw noIdentity();
          await startSession(ctx, identity, "zero-trust");
          throw ctx.redirect(safeCallbackPath(ctx.query?.callbackURL));
        },
      ),

      // Dev mode (local only): sign in as any email.
      devSignIn: createAuthEndpoint("/dev/sign-in", { method: "POST", body: devSignInBody }, async (ctx) => {
        if (mode.kind !== "dev") throw notFound();
        const identity: Identity = { email: ctx.body.email.trim().toLowerCase(), name: ctx.body.name ?? null };
        const { user, session } = await startSession(ctx, identity, "dev");
        return ctx.json({ user: { id: user.id, name: user.name, email: user.email }, token: session.token });
      }),
    },
    hooks: {
      // Identity mode: every other auth endpoint (invites, session, sign-out) needs the provider's
      // token, and a session counts only for the person the token belongs to.
      before: [
        {
          matcher: (ctx) => mode.kind === "identity" && ctx.path !== IDENTITY_SIGN_IN_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            if (mode.kind !== "identity") return;
            const identity = ctx.headers ? await mode.verify(ctx.headers) : null;
            if (!identity) throw noIdentity();
            const session = await getSessionFromCtx(ctx);
            if (session && session.user.email.toLowerCase() !== identity.email) {
              throw new APIError("UNAUTHORIZED", { message: "Session belongs to someone else" });
            }
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
