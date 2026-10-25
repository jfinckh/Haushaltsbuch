import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { MonthPicker } from "./month-picker";

/** How many years before the current one the year list offers. */
const PAST_YEARS = 10;

/** The earliest month the switcher links to (insights accepts nothing earlier). */
const FIRST_MONTH = "1970-01";

/** The month `delta` months after `month` (YYYY-MM). */
export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The month (YYYY-MM) of today's local date. */
export function currentMonth(): string {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** The month named in the address, or the current one when it is missing, malformed or in the future. */
export function chosenMonth(value: string | undefined): string {
  const current = currentMonth();
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= FIRST_MONTH && value <= current ? value : current;
}

/** ‹ previous month · month and year lists · next month ›; no next month after the current one. */
export async function MonthSwitcher({ month, accountId }: { month: string; accountId: string }) {
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const name = (m: string, style: "long" | "short") =>
    format.dateTime(new Date(`${m}-01T00:00:00Z`), { month: style, ...(style === "long" ? { year: "numeric" } : {}), timeZone: "UTC" });
  const href = (m: string) => `/statistics?${new URLSearchParams({ account: accountId, month: m })}`;
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const current = currentMonth();
  const currentYear = Number(current.slice(0, 4));
  const shownYear = Number(month.slice(0, 4));
  // The last 10 years, and the shown year when it lies further back (reached with the arrows or the address).
  const years = Array.from({ length: PAST_YEARS + 1 }, (_, i) => currentYear - i);
  if (!years.includes(shownYear)) years.push(shownYear);
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    format.dateTime(new Date(Date.UTC(2000, i, 1)), { month: "long", timeZone: "UTC" }),
  );

  return (
    <nav aria-label={t("monthSwitcher")} className="flex items-center justify-between">
      {previous >= FIRST_MONTH ? (
        <Link href={href(previous)} className="btn btn-ghost btn-sm" aria-label={t("previousMonth")}>
          ‹ {name(previous, "short")}
        </Link>
      ) : (
        <span className="w-16" />
      )}
      <h2 className="sr-only">{name(month, "long")}</h2>
      <MonthPicker
        month={month}
        current={current}
        accountId={accountId}
        monthNames={monthNames}
        years={years}
        labels={{ month: t("month"), year: t("year") }}
      />
      {next <= current ? (
        <Link href={href(next)} className="btn btn-ghost btn-sm" aria-label={t("nextMonth")}>
          {name(next, "short")} ›
        </Link>
      ) : (
        <span className="w-16" />
      )}
    </nav>
  );
}
