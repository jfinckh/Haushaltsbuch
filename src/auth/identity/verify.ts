import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

// Checks the signed login token a zero-trust proxy (Cloudflare Access, Pomerium, ...) adds to every
// request. Only the signed token counts: plain identity headers such as
// Cf-Access-Authenticated-User-Email can be sent by anyone who reaches the app and are never read.

export const DEFAULT_IDENTITY_HEADER = "Cf-Access-Jwt-Assertion";

export type IdentityOptions = {
  /** Address of the provider that signs the tokens, e.g. https://<team>.cloudflareaccess.com */
  issuer: string;
  /** The provider's public keys, e.g. https://<team>.cloudflareaccess.com/cdn-cgi/access/certs */
  jwksUrl: string;
  /** Who the token is made for: Cloudflare's application AUD tag. */
  audience: string;
  /** Request header with the token. Default: Cf-Access-Jwt-Assertion */
  header?: string;
  /** Keys to check against instead of jwksUrl. For tests. */
  keys?: JWTVerifyGetKey;
};

export type Identity = {
  /** Lower case. */
  email: string;
  name: string | null;
};

export type IdentityVerifier = (headers: Headers) => Promise<Identity | null>;

const MAX_TOKEN_LENGTH = 16_384;
const CLOCK_TOLERANCE_SECONDS = 30;

/** Builds a verifier that reads the token from the request headers. The provider's keys are cached. */
export function createIdentityVerifier(options: IdentityOptions): IdentityVerifier {
  const header = options.header ?? DEFAULT_IDENTITY_HEADER;
  const keys = options.keys ?? createRemoteJWKSet(new URL(options.jwksUrl));

  return async (headers) => {
    const token = headers.get(header);
    if (!token || token.length > MAX_TOKEN_LENGTH) return null;
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: options.issuer,
        audience: options.audience,
        requiredClaims: ["exp"],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
      if (!email.includes("@")) return null;
      const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null;
      return { email, name };
    } catch {
      // Invalid, expired, foreign or unreadable token. The reason is not logged: it could hold the email.
      return null;
    }
  };
}

/** The name for a new user: the token's name, else the part of the email before "@". */
export function displayNameFor(identity: Identity): string {
  return (identity.name ?? identity.email.split("@")[0]).slice(0, 100);
}
