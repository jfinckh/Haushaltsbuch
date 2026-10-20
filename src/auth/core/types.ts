/**
 * Types shared by the server and the client side of the auth module.
 * Nothing in here may import from the host app.
 */

export type AuthLocale = "de" | "en";

/** Paths of the auth pages in the host app. */
export interface AuthRoutes {
  signIn: string;
  signUp: string;
  forgotPassword: string;
  resetPassword: string;
  twoFactor: string;
  account: string;
  admin: string;
  /** Where to go after a successful sign-in when no `redirectTo` is given. */
  afterSignIn: string;
  afterSignOut: string;
}

export const defaultAuthRoutes: AuthRoutes = {
  signIn: "/sign-in",
  signUp: "/sign-up",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  twoFactor: "/two-factor",
  account: "/account",
  admin: "/admin/users",
  afterSignIn: "/",
  afterSignOut: "/sign-in",
};

/** Which optional features the UI should offer. Must match the server config. */
export interface AuthFeatures {
  signUp: SignUpMode;
  passkey: boolean;
  twoFactor: boolean;
  requireEmailVerification: boolean;
  deleteAccount: boolean;
  minPasswordLength: number;
  /** OAuth providers configured on the server, e.g. ["google", "github"]. */
  socialProviders: string[];
}

export const defaultAuthFeatures: AuthFeatures = {
  signUp: "invite-only",
  passkey: true,
  twoFactor: true,
  requireEmailVerification: true,
  deleteAccount: true,
  minPasswordLength: 10,
  socialProviders: [],
};

/**
 * - `open`: anyone can register.
 * - `invite-only`: registration needs an invite token the host app accepts.
 * - `closed`: only admins can create users.
 *
 * In every mode the very first user can register, so a fresh install
 * is never locked out.
 */
export type SignUpMode = "open" | "invite-only" | "closed";

/** Request header the sign-up form uses to send the invite token. */
export const INVITE_HEADER = "x-auth-invite";

export const ADMIN_ROLE = "admin";
export const USER_ROLE = "user";

export type AuthEmailKind = "verify-email" | "reset-password";

/** An email the auth module wants sent. The host app delivers it. */
export interface AuthEmail {
  kind: AuthEmailKind;
  to: string;
  url: string;
  user: { id: string; name: string; email: string };
}

/** A narrow, client-safe view of the signed-in user. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role?: string | null;
  emailVerified: boolean;
  twoFactorEnabled?: boolean | null;
}
