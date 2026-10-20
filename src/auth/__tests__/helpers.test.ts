import { describe, expect, it } from "vitest";
import { safeRedirectPath, withRedirect } from "../core/redirect";
import { hasRole } from "../core/roles";
import { de } from "../i18n/de";
import { en } from "../i18n/en";
import { errorMessage, format, getAuthMessages } from "../i18n/messages";
import { isPublicPath } from "../proxy";
import { renderAuthEmail } from "../server/email";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("safeRedirectPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeRedirectPath("/account?tab=1", "/")).toBe("/account?tab=1");
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", ""])(
    "rejects %s",
    (value) => expect(safeRedirectPath(value, "/")).toBe("/"),
  );
  it("adds redirectTo to a path", () => {
    expect(withRedirect("/sign-in", "/account")).toBe("/sign-in?redirectTo=%2Faccount");
    expect(withRedirect("/sign-in", "/")).toBe("/sign-in");
  });
});

describe("hasRole", () => {
  it("reads comma-separated roles", () => {
    expect(hasRole({ role: "user, admin" }, "admin")).toBe(true);
    expect(hasRole({ role: "user" }, "admin")).toBe(false);
    expect(hasRole(null, "admin")).toBe(false);
  });
});

describe("isPublicPath", () => {
  const publicPaths = ["/sign-in", "/api/auth"];
  it("matches exact paths and sub-paths only", () => {
    expect(isPublicPath("/sign-in", publicPaths)).toBe(true);
    expect(isPublicPath("/api/auth/get-session", publicPaths)).toBe(true);
    expect(isPublicPath("/sign-in-evil", publicPaths)).toBe(false);
    expect(isPublicPath("/", publicPaths)).toBe(false);
  });
});

describe("messages", () => {
  it("German and English have the same keys", () => {
    expect(keys(de).sort()).toEqual(keys(en).sort());
  });
  it("applies overrides without losing other keys", () => {
    const m = getAuthMessages("de", { signIn: { title: "Willkommen" } });
    expect(m.signIn.title).toBe("Willkommen");
    expect(m.signIn.submit).toBe("Anmelden");
  });
  it("formats placeholders", () => {
    expect(format("Hallo {name}, {missing}", { name: "Erika" })).toBe("Hallo Erika, {missing}");
  });
  it("maps error codes, gate errors and rate limits", () => {
    const m = getAuthMessages("en");
    expect(errorMessage(m, { code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(m.errors.INVALID_EMAIL_OR_PASSWORD);
    expect(errorMessage(m, { message: "SIGN_UP_INVITE_REQUIRED" })).toBe(m.errors.SIGN_UP_INVITE_REQUIRED);
    expect(errorMessage(m, { status: 429 })).toBe(m.errors.RATE_LIMITED);
    expect(errorMessage(m, { code: "SOMETHING_NEW" })).toBe(m.errors.generic);
  });
});

describe("renderAuthEmail", () => {
  it("renders a German reset email with the link", () => {
    const mail = renderAuthEmail(
      {
        kind: "reset-password",
        to: "erika@example.com",
        url: "https://app.example/reset?token=abc",
        user: { id: "1", name: "Erika", email: "erika@example.com" },
      },
      { appName: "Haushaltsbuch", locale: "de" },
    );
    expect(mail.subject).toBe("Passwort zurücksetzen");
    expect(mail.text).toContain("Hallo Erika");
    expect(mail.text).toContain("https://app.example/reset?token=abc");
  });
});
