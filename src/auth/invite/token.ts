import { createHash, randomBytes } from "node:crypto";

// 32 random bytes, URL-safe: long enough that links can't be guessed.
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
