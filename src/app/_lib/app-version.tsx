import { useTranslations } from "next-intl";

const berlinTime = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * The version text, e.g. "4d4fd9d · 28.10.2026, 23:15": short commit and build time (German time,
 * German format in both languages). Locally just "dev".
 */
export function formatAppVersion(version: string, builtAt: string): string {
  const commit = /^[0-9a-f]{40}$/.test(version) ? version.slice(0, 7) : version;
  const time = new Date(builtAt);
  return builtAt && !Number.isNaN(time.getTime()) ? `${commit} · ${berlinTime.format(time)}` : commit;
}

/** The deployed version (set at build time, see next.config.ts). */
export function AppVersion({ className = "" }: { className?: string }) {
  const t = useTranslations("app.nav");
  const version = formatAppVersion(process.env.APP_VERSION || "dev", process.env.APP_BUILT_AT || "");
  return <p className={`text-xs text-base-content/50 ${className}`}>{t("version", { version })}</p>;
}
