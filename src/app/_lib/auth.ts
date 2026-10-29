import "server-only";
import { createAuth, type AuthOptions } from "@/auth/server";
import { db } from "@/db/server";
import { requireEnv } from "./env";

/**
 * Who may use the app in identity mode, from ALLOWED_EMAILS (comma-separated). Required, so a
 * too open Cloudflare Access policy alone never lets strangers in.
 */
function allowedEmails(): string[] {
  const emails = requireEnv("ALLOWED_EMAILS")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) throw new Error("ALLOWED_EMAILS lists no email");
  return emails;
}

/**
 * How people sign in, from AUTH_MODE. Unset means "identity": the zero-trust provider, whose
 * settings are then required. "dev" is the local sign-in; createAuth refuses it outside next dev
 * on localhost.
 */
function authMode(): AuthOptions["mode"] {
  const mode = process.env.AUTH_MODE || "identity";
  if (mode === "dev") return { kind: "dev" };
  if (mode !== "identity") throw new Error("AUTH_MODE must be identity or dev");
  return {
    kind: "identity",
    issuer: requireEnv("IDENTITY_ISSUER"),
    jwksUrl: requireEnv("IDENTITY_JWKS_URL"),
    audience: requireEnv("IDENTITY_AUDIENCE"),
    header: process.env.IDENTITY_JWT_HEADER || undefined,
    allowedEmails: allowedEmails(),
    logoutUrl: process.env.IDENTITY_LOGOUT_URL || "/cdn-cgi/access/logout",
  };
}

export const auth = createAuth({
  db,
  secret: requireEnv("BETTER_AUTH_SECRET"),
  baseURL: requireEnv("BETTER_AUTH_URL"),
  mode: authMode(),
  invitePath: "/invite",
});
