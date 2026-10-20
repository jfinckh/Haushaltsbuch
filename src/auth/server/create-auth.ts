import { passkey } from "@better-auth/passkey";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, twoFactor } from "better-auth/plugins";
import {
  ADMIN_ROLE,
  INVITE_HEADER,
  USER_ROLE,
  defaultAuthFeatures,
  type AuthEmail,
  type AuthFeatures,
  type SignUpMode,
} from "../core/types";

export interface SignUpCheck {
  email: string;
  /** Token from the invite link, if the sign-up form got one. */
  inviteToken: string | null;
  request?: Request;
}

export interface CreateAuthOptions {
  /** Shown in emails, the 2FA app and the passkey prompt. */
  appName: string;
  /** Public URL of the app, e.g. https://haushalt.example. Falls back to BETTER_AUTH_URL. */
  baseURL?: string;
  /** Falls back to BETTER_AUTH_SECRET. */
  secret?: string;
  /** Any database better-auth accepts: a pg Pool, a Drizzle/Prisma adapter, … */
  database: BetterAuthOptions["database"];
  /** Delivers verification and password-reset emails. */
  sendEmail: (email: AuthEmail) => Promise<void>;
  signUp?: {
    mode?: SignUpMode;
    /**
     * Called in `invite-only` mode. Return true to let this person register.
     * The host app owns invitations (e.g. a household invite link).
     */
    canSignUp?: (check: SignUpCheck) => Promise<boolean>;
    /** Runs after a user was created, e.g. to accept the invite. */
    onSignUp?: (user: { id: string; email: string }, check: SignUpCheck) => Promise<void>;
  };
  /** Give the first user that registers the admin role. Default: true. */
  firstUserIsAdmin?: boolean;
  requireEmailVerification?: boolean;
  minPasswordLength?: number;
  passkey?: { rpID?: string; origin?: string };
  socialProviders?: BetterAuthOptions["socialProviders"];
  /**
   * Called before a user deletes their own account. Remove or anonymize the
   * host app's data here; throw to stop the deletion.
   */
  beforeUserDelete?: (user: { id: string; email: string }) => Promise<void>;
  /** Extra origins allowed to call the auth API. */
  trustedOrigins?: string[];
}

function inviteTokenFrom(headers: Headers | undefined | null) {
  return headers?.get(INVITE_HEADER) ?? null;
}

export function createAuth(options: CreateAuthOptions) {
  const signUpMode = options.signUp?.mode ?? defaultAuthFeatures.signUp;
  const requireEmailVerification =
    options.requireEmailVerification ?? defaultAuthFeatures.requireEmailVerification;
  const firstUserIsAdmin = options.firstUserIsAdmin ?? true;
  const minPasswordLength = options.minPasswordLength ?? defaultAuthFeatures.minPasswordLength;

  /** Returns an error code when this sign-up is not allowed, else null. */
  async function checkSignUp(
    ctx: { context: { adapter: { count: (q: { model: string }) => Promise<number> } } },
    check: SignUpCheck,
  ): Promise<string | null> {
    const userCount = await ctx.context.adapter.count({ model: "user" });
    if (userCount === 0) return null; // bootstrap: the first user may always register
    if (signUpMode === "open") return null;
    if (signUpMode === "closed") return "SIGN_UP_DISABLED";
    const allowed = await options.signUp?.canSignUp?.(check);
    return allowed ? null : "SIGN_UP_INVITE_REQUIRED";
  }

  const auth = betterAuth({
    appName: options.appName,
    baseURL: options.baseURL,
    secret: options.secret,
    database: options.database,
    trustedOrigins: options.trustedOrigins,
    socialProviders: options.socialProviders,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      minPasswordLength,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) =>
        options.sendEmail({ kind: "reset-password", to: user.email, url, user }),
    },
    emailVerification: {
      sendOnSignUp: requireEmailVerification,
      sendOnSignIn: requireEmailVerification,
      autoSignInAfterVerification: true,
      sendVerificationEmail: ({ user, url }) =>
        options.sendEmail({ kind: "verify-email", to: user.email, url, user }),
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          await options.beforeUserDelete?.({ id: user.id, email: user.email });
        },
      },
      // Gate every other way a user can be created (OAuth, …). Email sign-up
      // is checked earlier in `hooks.before` so the form gets a clear error
      // instead of better-auth's generic "check your inbox" response.
      validateUserInfo: async ({ user, source }, ctx) => {
        if (source.action !== "create-user") return;
        // Admins may always create users; email sign-up was checked already.
        if (source.method === "admin" || source.method === "email-password") return;
        const error = await checkSignUp(ctx, {
          email: String(user.email ?? ""),
          inviteToken: inviteTokenFrom(ctx.headers),
          request: ctx.request,
        });
        if (error) return { error };
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const error = await checkSignUp(ctx, {
          email: String(ctx.body?.email ?? ""),
          inviteToken: inviteTokenFrom(ctx.headers),
          request: ctx.request,
        });
        if (error) throw new APIError("FORBIDDEN", { code: error, message: error });
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (!firstUserIsAdmin || !ctx) return;
            const userCount = await ctx.context.adapter.count({ model: "user" });
            if (userCount === 0) return { data: { ...user, role: ADMIN_ROLE } };
          },
          after: async (user, ctx) => {
            if (!options.signUp?.onSignUp) return;
            await options.signUp.onSignUp(
              { id: user.id, email: user.email },
              { email: user.email, inviteToken: inviteTokenFrom(ctx?.headers), request: ctx?.request },
            );
          },
        },
      },
    },
    plugins: [
      admin({ defaultRole: USER_ROLE, adminRoles: [ADMIN_ROLE] }),
      twoFactor({ issuer: options.appName }),
      passkey({
        rpName: options.appName,
        rpID: options.passkey?.rpID,
        origin: options.passkey?.origin,
      }),
      // Must stay last: lets server actions set cookies in Next.js.
      nextCookies(),
    ],
  });

  const features: AuthFeatures = {
    ...defaultAuthFeatures,
    signUp: signUpMode,
    requireEmailVerification,
    minPasswordLength,
    socialProviders: Object.keys(options.socialProviders ?? {}),
  };

  return Object.assign(auth, { features });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
