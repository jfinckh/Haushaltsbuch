// The languages of the UI. Kept free of next-intl so any part (and the proxy) can read it.

export const LOCALES = ["de", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Used when neither the cookie nor the browser names a supported language. */
export const DEFAULT_LOCALE: Locale = "de";

/** Cookie that remembers the language a person chose. next-intl reads it too. */
export const LOCALE_COOKIE = "NEXT_LOCALE";
