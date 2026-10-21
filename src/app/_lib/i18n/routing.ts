import { defineRouting } from "next-intl/routing";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES } from "@/shared/i18n";

/**
 * Addresses carry no language ("/sign-in", not "/de/sign-in"). The proxy picks the language from
 * the cookie, then the browser, then the default, and rewrites to the [locale] folder.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "never",
  localeCookie: { name: LOCALE_COOKIE, maxAge: 60 * 60 * 24 * 365 },
});
