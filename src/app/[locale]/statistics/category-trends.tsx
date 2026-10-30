import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { CategoryTrends as Trends } from "@/insights/server";
import { bookingsHref } from "@/app/_lib/bookings-href";
import { formatEuro } from "@/shared/money";
import { useCategoryName } from "@/transactions";

type Direction = Trends["groups"][number]["difference"]["direction"];

/** The first day of a YYYY-MM month as a date, for the month-name formatter. */
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

const TONE: Record<Direction, string> = { more: "text-error", less: "text-success", same: "text-base-content/60" };
const ARROW: Record<Direction, string> = { more: "↑", less: "↓", same: "≈" };

/**
 * Spending per category group in the chosen month (the trend's last month): the amount, its share of
 * the month's spending as a bar, and in words whether it is more, less or about the same as usual
 * (the average of the 3 months before). The name links to the bookings of the month and group.
 */
export function CategoryTrends({
  trends,
  account,
  origin,
  categoryNames,
}: {
  trends: Trends;
  /** An account id or "all". */
  account: string;
  /** The address of the page, for the bookings links. */
  origin: string;
  /** Names of own categories (the page's catalog). */
  categoryNames: Record<string, string>;
}) {
  const t = useTranslations("app.statistics");
  const uncategorized = useTranslations("transactions.spending")("uncategorized");
  const categoryName = useCategoryName(categoryNames);
  const format = useFormatter();
  const { months, groups } = trends;
  const month = months.at(-1)!;
  const name = (m: string, style: "long" | "short") => format.dateTime(monthDate(m), { month: style, timeZone: "UTC" });
  // The 3 months the usual spending is averaged over.
  const usualFrom = months.at(-4) ?? months[0];
  const usualTo = months.at(-2) ?? months[0];
  const centsOf = (group: Trends["groups"][number]) => Math.max(0, group.trend.at(-1) ?? 0);
  const totalCents = groups.reduce((sum, g) => sum + centsOf(g), 0);

  return (
    <section className="flex min-w-0 flex-col gap-3 border-t border-base-300 pt-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold">{t("categoriesOf", { month: name(month, "long") })}</h2>
        <p className="text-sm text-base-content/60">{t("categoriesHint", { from: name(usualFrom, "long"), to: name(usualTo, "long") })}</p>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-base-content/60">{t("noCategorySpending")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-base-300">
          {groups.map((g) => {
            const label = g.group ? categoryName(g.group) : uncategorized;
            const cents = centsOf(g);
            const share = totalCents > 0 ? Math.round((cents * 100) / totalCents) : 0;
            const { direction, cents: difference } = g.difference;
            const note =
              g.average3Cents === 0
                ? t("usualNone")
                : direction === "same"
                  ? t("usualSame")
                  : t(direction === "more" ? "usualMore" : "usualLess", { amount: formatEuro(Math.abs(difference)) });
            const href = bookingsHref({ account, month, kind: "expense", category: g.group, origin });
            return (
              <li key={g.group ?? ""} className="flex flex-col gap-1.5 py-3">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <h3 className="min-w-0 truncate font-medium">
                    <Link href={href} className="link link-hover">
                      {label}
                    </Link>
                  </h3>
                  <span className="shrink-0 tabular-nums">
                    <span className="font-medium">{formatEuro(cents)}</span>{" "}
                    <span className="text-base-content/50">· {t("share", { percent: share })}</span>
                  </span>
                </div>
                <progress className="progress progress-primary h-2 w-full" value={cents} max={Math.max(1, totalCents)} aria-label={`${label}: ${t("share", { percent: share })}`} />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                  <span className={`flex gap-1 ${g.average3Cents === 0 ? TONE.same : TONE[direction]}`}>
                    {g.average3Cents > 0 && <span aria-hidden>{ARROW[direction]}</span>}
                    <span>{note}</span>
                  </span>
                  {g.average3Cents > 0 && <span className="text-base-content/50 tabular-nums">{t("usualAmount", { amount: formatEuro(g.average3Cents) })}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
