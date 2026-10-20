import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { buildBetterAuth } from "./create-auth";

export const TEST_BASE_URL = "http://localhost:3000";

/** A Better Auth instance on a fresh in-memory Postgres with the real migrations. */
export async function createTestAuth(options: { inviteTtlSeconds?: number } = {}) {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  const auth = buildBetterAuth({
    db,
    secret: "test-secret-test-secret-test-secret-123",
    baseURL: TEST_BASE_URL,
    inviteTtlSeconds: options.inviteTtlSeconds,
  });
  return { auth, db };
}

type Auth = Awaited<ReturnType<typeof createTestAuth>>["auth"];

/** A browser stand-in: sends requests to the auth handler and keeps its cookies. */
export function createBrowser(auth: Auth) {
  const cookies = new Map<string, string>();

  async function request(path: string, init: { method?: string; body?: unknown } = {}) {
    const headers = new Headers({ origin: TEST_BASE_URL });
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
    return { status: response.status, json: text ? JSON.parse(text) : null };
  }

  return {
    request,
    signUp: (name: string, email: string, password = "geheim1234") =>
      request("/sign-up/email", { body: { name, email, password } }),
    signIn: (email: string, password = "geheim1234") => request("/sign-in/email", { body: { email, password } }),
    signOut: () => request("/sign-out", { body: {} }),
    createInvite: () => request("/invite/create", { body: {} }),
    openInvite: (token: string) => request("/invite/open", { body: { token } }),
    getInviter: () => request("/invite/inviter"),
    hasCookie: (suffix: string) => [...cookies.keys()].some((k) => k.endsWith(suffix)),
  };
}

export function tokenFromUrl(url: string): string {
  return new URL(url).pathname.split("/").pop()!;
}
