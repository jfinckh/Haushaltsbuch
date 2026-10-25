import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { buildBetterAuth, type AuthMode } from "./create-auth";
import { createTestIdentityProvider } from "./identity/test-provider";
import { createIdentityVerifier } from "./identity/verify";

export const TEST_BASE_URL = "http://localhost:3000";

/**
 * A Better Auth instance on a fresh in-memory Postgres with the real migrations. Dev mode by default
 * (sign in as any email); identity mode checks tokens of a test provider (`provider.sign`).
 */
export async function createTestAuth(options: { inviteTtlSeconds?: number; mode?: AuthMode["kind"] } = {}) {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  const provider = await createTestIdentityProvider();
  const identity = options.mode === "identity";
  const authOptions = {
    db,
    secret: "test-secret-test-secret-test-secret-123",
    baseURL: TEST_BASE_URL,
    inviteTtlSeconds: options.inviteTtlSeconds,
    mode: identity ? { kind: "identity" as const, logoutUrl: "/cdn-cgi/access/logout", ...provider.options } : { kind: "dev" as const },
  };
  const auth = buildBetterAuth(
    authOptions,
    identity ? { kind: "identity", verify: createIdentityVerifier(provider.options) } : { kind: "dev" },
  );
  return { auth, db, provider, authOptions };
}

type Auth = Awaited<ReturnType<typeof createTestAuth>>["auth"];

/** A browser stand-in: sends requests to the auth handler and keeps its cookies. */
export function createBrowser(auth: Auth) {
  const cookies = new Map<string, string>();
  /** The provider's token this browser sends with every request (identity mode). */
  let identityToken: string | null = null;

  async function request(path: string, init: { method?: string; body?: unknown } = {}) {
    const headers = new Headers({ origin: TEST_BASE_URL });
    if (identityToken) headers.set("Cf-Access-Jwt-Assertion", identityToken);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (cookies.size) headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const response = await auth.handler(
      new Request(`${TEST_BASE_URL}/api/auth${path}`, {
        method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      }),
    );
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";");
      const [name, ...rest] = pair.split("=");
      const value = rest.join("=");
      const expired = attributes.some((a) => /max-age=0\b/i.test(a.trim())) || value === "";
      if (expired) cookies.delete(name.trim());
      else cookies.set(name.trim(), value);
    }
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, location: response.headers.get("location") };
  }

  return {
    request,
    /** Dev mode: signs in as a new (or existing) user. */
    signUp: (name: string, email: string) => request("/dev/sign-in", { body: { name, email } }),
    /** Dev mode: signs in as an existing (or new) user. */
    signIn: (email: string) => request("/dev/sign-in", { body: { email } }),
    /** Identity mode: from now on this browser sends `token` like the zero-trust proxy does. */
    useIdentityToken: (token: string | null) => {
      identityToken = token;
    },
    /** Identity mode: what the sign-in page redirects to. */
    identitySignIn: (callbackURL = "/") => request(`/identity/sign-in?callbackURL=${encodeURIComponent(callbackURL)}`),
    signOut: () => request("/sign-out", { body: {} }),
    createInvite: () => request("/invite/create", { body: {} }),
    openInvite: (token: string) => request("/invite/open", { body: { token } }),
    acceptInvite: (token: string) => request("/invite/accept", { body: { token } }),
    getInviter: () => request("/invite/inviter"),
    cookieHeader: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    hasCookie: (suffix: string) => [...cookies.keys()].some((k) => k.endsWith(suffix)),
  };
}

export function tokenFromUrl(url: string): string {
  return new URL(url).pathname.split("/").pop()!;
}
