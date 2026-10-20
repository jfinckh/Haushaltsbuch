import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { INVITE_HEADER } from "../core/types";
import { createAuth, type CreateAuthOptions } from "../server/create-auth";

function setup(signUp: CreateAuthOptions["signUp"]) {
  const db: Record<string, unknown[]> = {
    user: [], session: [], account: [], verification: [], twoFactor: [], passkey: [],
  };
  const emails: string[] = [];
  const auth = createAuth({
    appName: "Test",
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(db),
    requireEmailVerification: false,
    sendEmail: async (email) => {
      emails.push(email.kind);
    },
    signUp,
  });
  const signUpEmail = (email: string, invite?: string) =>
    auth.api.signUpEmail({
      body: { name: email, email, password: "supersecret1" },
      headers: new Headers(invite ? { [INVITE_HEADER]: invite } : {}),
    });
  return { auth, db, signUpEmail };
}

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (e) {
    return (e as { body?: { code?: string } }).body?.code ?? String(e);
  }
}

describe("sign-up gate", () => {
  it("lets the first user register and makes them admin", async () => {
    const { signUpEmail } = setup({ mode: "closed" });
    const result = await signUpEmail("first@example.com");
    expect(result.user.role).toBe("admin");
  });

  it("blocks later sign-ups in closed mode", async () => {
    const { signUpEmail } = setup({ mode: "closed" });
    await signUpEmail("first@example.com");
    expect(await errorCode(signUpEmail("second@example.com"))).toBe("SIGN_UP_DISABLED");
  });

  it("needs an accepted invite in invite-only mode", async () => {
    const accepted: string[] = [];
    const { signUpEmail } = setup({
      mode: "invite-only",
      canSignUp: async ({ inviteToken }) => inviteToken === "good",
      onSignUp: async (user, check) => {
        accepted.push(`${user.email}:${check.inviteToken}`);
      },
    });
    await signUpEmail("first@example.com");
    expect(await errorCode(signUpEmail("nobody@example.com"))).toBe("SIGN_UP_INVITE_REQUIRED");
    expect(await errorCode(signUpEmail("wrong@example.com", "bad"))).toBe("SIGN_UP_INVITE_REQUIRED");
    const ok = await signUpEmail("invited@example.com", "good");
    expect(ok.user.role).toBe("user");
    expect(accepted).toContain("invited@example.com:good");
  });

  it("lets anyone register in open mode", async () => {
    const { signUpEmail } = setup({ mode: "open" });
    await signUpEmail("first@example.com");
    const second = await signUpEmail("second@example.com");
    expect(second.user.role).toBe("user");
  });
});
