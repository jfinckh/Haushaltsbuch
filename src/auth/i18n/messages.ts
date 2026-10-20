import type { AuthLocale } from "../core/types";
import { de } from "./de";
import { en } from "./en";

type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };

export type AuthMessages = DeepString<typeof en>;
export type AuthMessageOverrides = DeepPartial<AuthMessages>;

const catalogs: Record<AuthLocale, AuthMessages> = { de, en };

function merge<T extends object>(base: T, override: DeepPartial<T> | undefined): T {
  if (!override) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = (base as Record<string, unknown>)[key];
    out[key] =
      typeof value === "object" && value !== null && typeof current === "object"
        ? merge(current as object, value as DeepPartial<object>)
        : value;
  }
  return out as T;
}

/** The message catalog for a locale, with optional per-app overrides. */
export function getAuthMessages(
  locale: AuthLocale = "de",
  overrides?: AuthMessageOverrides,
): AuthMessages {
  return merge(catalogs[locale] ?? catalogs.de, overrides);
}

/** Replace `{name}` placeholders. */
export function format(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Turn a better-auth error (or anything thrown) into a user-facing message. */
export function errorMessage(
  messages: AuthMessages,
  error: { code?: string; status?: number; message?: string } | null | undefined,
): string {
  if (!error) return messages.errors.generic;
  if (error.status === 429) return messages.errors.RATE_LIMITED;
  const errors = messages.errors as Record<string, string>;
  // Our own gate errors travel in `message`, better-auth's in `code`.
  for (const key of [error.code, error.message]) {
    if (key && errors[key]) return errors[key];
  }
  return messages.errors.generic;
}
