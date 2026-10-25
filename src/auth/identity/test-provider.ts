import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Identity, IdentityOptions } from "./verify";

// A stand-in for the zero-trust provider in tests: its own key pair, and tokens signed like
// Cloudflare Access signs them.

export const TEST_IDENTITY: Identity = { email: "max@example.test", name: null };

type TokenInput = {
  email: string;
  name?: string;
  issuer?: string;
  audience?: string;
  /** Seconds from now; negative for an expired token. Default: one hour. */
  expiresIn?: number;
};

export async function createTestIdentityProvider() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  const options: IdentityOptions = {
    issuer: "https://test-team.cloudflareaccess.com",
    jwksUrl: "https://test-team.cloudflareaccess.com/cdn-cgi/access/certs",
    audience: "test-audience",
    keys: createLocalJWKSet({ keys: [jwk] }),
  };

  async function sign(input: TokenInput): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = { email: input.email };
    if (input.name) claims.name = input.name;
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(input.issuer ?? options.issuer)
      .setAudience(input.audience ?? options.audience)
      .setSubject(input.email)
      .setIssuedAt(now)
      .setExpirationTime(now + (input.expiresIn ?? 3600))
      .sign(privateKey);
  }

  return { options, sign };
}
