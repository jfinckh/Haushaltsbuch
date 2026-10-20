import type { AuthEmail, AuthLocale } from "../core/types";
import { format, getAuthMessages, type AuthMessageOverrides } from "../i18n/messages";

export interface RenderedAuthEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Plain-text default for the emails the auth module sends. Host apps can use
 * it as is, or ignore it and render their own templates from `AuthEmail`.
 */
export function renderAuthEmail(
  email: AuthEmail,
  options: { appName: string; locale?: AuthLocale; messages?: AuthMessageOverrides },
): RenderedAuthEmail {
  const m = getAuthMessages(options.locale, options.messages).email;
  const values = { name: email.user.name || email.to, app: options.appName, url: email.url };
  const [subject, body] =
    email.kind === "verify-email"
      ? [m.verifySubject, m.verifyBody]
      : [m.resetSubject, m.resetBody];
  return { to: email.to, subject, text: format(body, values) };
}
