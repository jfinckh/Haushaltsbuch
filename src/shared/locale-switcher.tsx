"use client";

import { useLocale, useTranslations } from "next-intl";
import { LOCALE_COOKIE, LOCALES, type Locale } from "./i18n";

const ONE_YEAR = 60 * 60 * 24 * 365;

// The language is part of the root layout, so the page reloads fully instead of a router refresh
// (which would keep the old-language page hidden in the DOM).
function switchTo(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  window.location.reload();
}

/** DE / EN toggle. Remembers the choice in a cookie and reloads the page in that language. */
export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const t = useTranslations("shared.localeSwitcher");
  const current = useLocale();

  function choose(locale: Locale) {
    if (locale === current) return;
    switchTo(locale);
  }

  return (
    <div role="group" aria-label={t("label")} className={`join ${className}`}>
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          aria-pressed={locale === current}
          title={t(locale)}
          className={`btn btn-xs join-item ${locale === current ? "btn-active" : "btn-ghost"}`}
          onClick={() => choose(locale)}
        >
          {locale.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
