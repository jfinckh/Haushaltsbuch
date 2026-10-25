import "server-only";
import { createAuth, type AuthOptions } from "@/auth/server";
import { db } from "@/db/server";
import { requireEnv } from "./env";

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
