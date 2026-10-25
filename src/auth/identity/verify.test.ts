import { describe, expect, it } from "vitest";
import { createIdentityVerifier, displayNameFor } from "./verify";
import { createTestIdentityProvider, TEST_IDENTITY } from "./test-provider";

const provider = await createTestIdentityProvider();
const verify = createIdentityVerifier(provider.options);

const withToken = (token: string, header = "Cf-Access-Jwt-Assertion") => new Headers({ [header]: token });

describe("createIdentityVerifier", () => {
  it("reads the email (lower case) and name from a valid token", async () => {
    const token = await provider.sign({ email: "Max@Example.test", name: "Max Mustermann" });
    expect(await verify(withToken(token))).toEqual({ email: "max@example.test", name: "Max Mustermann" });
  });

  it("returns no name when the token has none", async () => {
    const token = await provider.sign({ email: "max@example.test" });
    expect(await verify(withToken(token))).toEqual({ email: "max@example.test", name: null });
  });

  it("rejects a missing header", async () => {
    expect(await verify(new Headers())).toBeNull();
  });

  it("ignores the plain email header", async () => {
    expect(await verify(new Headers({ "Cf-Access-Authenticated-User-Email": "max@example.test" }))).toBeNull();
  });

  it.each([
    ["another audience", { audience: "other-app" }],
    ["another issuer", { issuer: "https://evil.example" }],
    ["an expired token", { expiresIn: -3600 }],
    ["no email", { email: "" }],
  ])("rejects %s", async (_label, overrides) => {
    const token = await provider.sign({ email: "max@example.test", ...overrides });
    expect(await verify(withToken(token))).toBeNull();
  });

  it("rejects a token signed with another key", async () => {
    const stranger = await createTestIdentityProvider();
    const token = await stranger.sign({ email: "max@example.test" });
    expect(await verify(withToken(token))).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verify(withToken("not.a.token"))).toBeNull();
  });

  it("reads another header when configured", async () => {
    const pomerium = createIdentityVerifier({ ...provider.options, header: "X-Pomerium-Jwt-Assertion" });
    const token = await provider.sign({ email: "max@example.test" });
    expect(await pomerium(withToken(token, "X-Pomerium-Jwt-Assertion"))).toMatchObject({ email: "max@example.test" });
    expect(await pomerium(withToken(token))).toBeNull();
  });
});

describe("displayNameFor", () => {
  it("uses the token's name, else the part before @", () => {
    expect(displayNameFor({ email: "max@example.test", name: "Max" })).toBe("Max");
    expect(displayNameFor(TEST_IDENTITY)).toBe("max");
  });
});
