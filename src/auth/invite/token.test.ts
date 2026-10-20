import { describe, expect, it } from "vitest";
import { generateInviteToken, hashInviteToken } from "./token";

describe("invite tokens", () => {
  it("are URL-safe and unique", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("hash deterministically and never equal the token", () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).not.toBe(token);
  });
});
