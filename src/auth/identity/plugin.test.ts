import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { assertDevAllowed, sessionForRequest } from "../create-auth";
import { authUser } from "../schema";
import { createBrowser, createTestAuth } from "../test-utils";
import { createIdentityVerifier } from "./verify";
import { safeCallbackPath } from "./plugin";

async function identitySetup() {
  const setup = await createTestAuth({ mode: "identity" });
  const verify = createIdentityVerifier(setup.provider.options);
  return { ...setup, verify };
}

async function users(db: Awaited<ReturnType<typeof createTestAuth>>["db"], email: string) {
  return db.select().from(authUser).where(eq(authUser.email, email));
}

describe("identity sign-in", () => {
  it("creates the user on the first visit and redirects to the callback", async () => {
    const { auth, db, provider } = await identitySetup();
    const browser = createBrowser(auth);
    browser.useIdentityToken(await provider.sign({ email: "Max@Example.test", name: "Max Mustermann" }));

    const res = await browser.identitySignIn("/accounts");
    expect(res.status).toBe(302);
    expect(res.location).toBe("/accounts");
    expect(browser.hasCookie("session_token")).toBe(true);
    const [user] = await users(db, "max@example.test");
    expect(user).toMatchObject({ name: "Max Mustermann", emailVerified: true });
  });

  it("reuses the user on later visits and keeps the name", async () => {
    const { auth, db, provider } = await identitySetup();
    const first = createBrowser(auth);
    first.useIdentityToken(await provider.sign({ email: "max@example.test", name: "Max" }));
    await first.identitySignIn();
    const second = createBrowser(auth);
    second.useIdentityToken(await provider.sign({ email: "max@example.test", name: "Maximilian" }));
    await second.identitySignIn();

    const rows = await users(db, "max@example.test");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Max");
  });

  it("names a user without a name in the token after the email", async () => {
    const { auth, db, provider } = await identitySetup();
    const browser = createBrowser(auth);
    browser.useIdentityToken(await provider.sign({ email: "erika.m@example.test" }));
    await browser.identitySignIn();
    expect((await users(db, "erika.m@example.test"))[0].name).toBe("erika.m");
  });

  it("refuses without a valid token and creates nobody", async () => {
    const { auth, db, provider } = await identitySetup();
    const browser = createBrowser(auth);
    expect((await browser.identitySignIn()).status).toBe(401);

    const stranger = await createTestAuth({ mode: "identity" });
    browser.useIdentityToken(await stranger.provider.sign({ email: "max@example.test" }));
    expect((await browser.identitySignIn()).status).toBe(401);
    browser.useIdentityToken(await provider.sign({ email: "max@example.test", expiresIn: -60 }));
    expect((await browser.identitySignIn()).status).toBe(401);
    expect(await users(db, "max@example.test")).toHaveLength(0);
  });

  it("only redirects inside the app", async () => {
    const { auth, provider } = await identitySetup();
    const browser = createBrowser(auth);
    browser.useIdentityToken(await provider.sign({ email: "max@example.test" }));
    expect((await browser.identitySignIn("https://evil.example")).location).toBe("/");
    expect(safeCallbackPath("//evil.example")).toBe("/");
    expect(safeCallbackPath("/\\evil.example")).toBe("/");
    expect(safeCallbackPath("/invite/abc")).toBe("/invite/abc");
  });

  it("has no dev sign-in and no email and password", async () => {
    const { auth, provider } = await identitySetup();
    const browser = createBrowser(auth);
    browser.useIdentityToken(await provider.sign({ email: "max@example.test" }));
    expect((await browser.signUp("Max", "max@example.test")).status).toBe(404);
    const password = await browser.request("/sign-up/email", {
      body: { name: "Max", email: "max@example.test", password: "geheim1234" },
    });
    expect(password.status).toBeGreaterThanOrEqual(400);
  });
});

describe("identity check on auth endpoints", () => {
  it("refuses invite endpoints without the provider's token", async () => {
    const { auth, provider } = await identitySetup();
    const browser = createBrowser(auth);
    browser.useIdentityToken(await provider.sign({ email: "max@example.test" }));
    await browser.identitySignIn();
    expect((await browser.createInvite()).status).toBe(200);

    browser.useIdentityToken(null);
    expect((await browser.createInvite()).status).toBe(401);
  });

  it("refuses a session that belongs to someone else", async () => {
    const { auth, provider } = await identitySetup();
    const browser = createBrowser(auth);
    browser.useIdentityToken(await provider.sign({ email: "max@example.test" }));
    await browser.identitySignIn();

    // Erika signs in at the provider in the same browser; Max's cookie is still there.
    browser.useIdentityToken(await provider.sign({ email: "erika@example.test" }));
    expect((await browser.createInvite()).status).toBe(401);
    expect((await browser.request("/get-session")).status).toBe(401);
  });
});

describe("sessionForRequest", () => {
  it("returns the session only while the token belongs to the same person", async () => {
    const { auth, provider, verify } = await identitySetup();
    const mode = { kind: "identity" as const, verify };
    const browser = createBrowser(auth);
    const maxToken = await provider.sign({ email: "max@example.test" });
    browser.useIdentityToken(maxToken);
    await browser.identitySignIn();
    const cookie = browser.cookieHeader();

    const request = (token: string | null) => {
      const headers = new Headers({ cookie });
      if (token) headers.set("Cf-Access-Jwt-Assertion", token);
      return sessionForRequest(auth, mode, headers);
    };
    expect((await request(maxToken))?.user.email).toBe("max@example.test");
    expect(await request(null)).toBeNull();
    expect(await request(await provider.sign({ email: "erika@example.test" }))).toBeNull();
  });
});

describe("dev sign-in", () => {
  it("signs in as any email and creates the user once", async () => {
    const { auth, db } = await createTestAuth();
    const browser = createBrowser(auth);
    const res = await browser.signUp("Max Mustermann", "Max@Example.test");
    expect(res.status).toBe(200);
    expect(res.json.user).toMatchObject({ name: "Max Mustermann", email: "max@example.test" });
    await createBrowser(auth).signIn("max@example.test");
    expect(await users(db, "max@example.test")).toHaveLength(1);
  });

  it("rejects bad input and has no identity sign-in", async () => {
    const { auth } = await createTestAuth();
    const browser = createBrowser(auth);
    expect((await browser.signUp("  ", "max@example.test")).status).toBe(400);
    expect((await browser.signIn("not-an-email")).status).toBe(400);
    expect((await browser.identitySignIn()).status).toBe(404);
  });
});

describe("assertDevAllowed", () => {
  it("allows next dev and tests on a local address", () => {
    expect(() => assertDevAllowed("development", "http://localhost:3000")).not.toThrow();
    expect(() => assertDevAllowed("development", "http://127.0.0.1:3000")).not.toThrow();
    expect(() => assertDevAllowed("development", "http://haushalt.localhost:3000")).not.toThrow();
    expect(() => assertDevAllowed("test", "http://localhost:3000")).not.toThrow();
  });

  it.each([
    ["production", "http://localhost:3000"],
    [undefined, "http://localhost:3000"],
    ["development", "https://haushalt.example.com"],
    ["development", "http://localhost.example.com"],
  ])("refuses NODE_ENV=%s with %s", (nodeEnv, url) => {
    expect(() => assertDevAllowed(nodeEnv, url)).toThrow();
  });
});
