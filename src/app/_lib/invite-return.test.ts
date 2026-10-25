import { describe, expect, it } from "vitest";
import { inviteReturn } from "./invite-return";

const TOKEN = "Q2hhbmdlTWFwVGVzdFRva2VuLTEyMzQ1Njc4OTA";

describe("inviteReturn", () => {
  it("leads back to the invite page and keeps the invite on the sign-in link", () => {
    expect(inviteReturn(TOKEN)).toEqual({
      redirectTo: `/invite/${TOKEN}`,
      signInHref: `/sign-in?invite=${TOKEN}`,
    });
    expect(inviteReturn([TOKEN, "other"]).redirectTo).toBe(`/invite/${TOKEN}`);
  });

  it("goes home for a missing parameter or anything that is not a token", () => {
    const home = { redirectTo: "/", signInHref: "/sign-in" };
    for (const param of [undefined, "", "short", "https://evil.example/x-0123456789abcdef", "//evil.example/0123456789abcdef", "../../etc/passwd-0123456789"]) {
      expect(inviteReturn(param)).toEqual(home);
    }
  });
});
