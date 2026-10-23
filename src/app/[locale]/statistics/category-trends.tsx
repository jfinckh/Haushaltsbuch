import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { Insights } from "@/insights/server";
import { formatEuro } from "@/shared/money";
import { useCategoryName } from "@/transactions";

type Trends = Extract<Awaited<ReturnType<Insights["categoryTrends"]>>, { ok: true }>;

/** The first day of a YYYY-MM month as a date, for the month-name formatter. */
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

/**
 * Spending per category group: 12 small bars (oldest left) and the averages over complete months.
 * With an account, each bar links to that account's bookings of the month and group.
 */
export function CategoryTrends({
  trends,
  accountId,
  categoryNames,
}: {
  trends: Trends;
  accountId: string | null;
  /** Names of own categories (the page's catalog). */
  categoryNames: Record<string, string>;
}) {
  const t = useTranslations("app.statistics");
  const uncategorized = useTranslations("transactions.spending")("uncategorized");
  const categoryName = useCategoryName(categoryNames);
  const format = useFormatter();
  const monthName = (month: string, style: "long" | "short") =>
    format.dateTime(monthDate(month), { month: style, year: "numeric", timeZone: "UTC" });
  const { months, groups } = trends;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col">
        <h2 className="text-lg font-semibold">{t("categories")}</h2>
        <p className="text-sm opacity-70">
          {t("categoriesHint", { from: monthName(months[0], "short"), to: monthName(months.at(-1)!, "short") })}
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm opacity-70">{t("noCategorySpending")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {groups.map(({ group, trend, average3Cents, average6Cents, average12Cents }) => {
            const name = group ? categoryName(group) : uncategorized;
            const scale = Math.max(1, ...trend);
            // No filter exists for bookings without category, and several accounts have no single list.
            const href = (month: string) =>
              accountId && group ? `/accounts/${accountId}?${new URLSearchParams({ month, kind: "expense", category: group })}` : null;
            const current = href(months.at(-1)!);
            return (
              <li key={group ?? ""} className="flex flex-col gap-1">
                <h3 className="font-medium">
                  {current ? (
                    <Link href={current} className="link link-hover">
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                </h3>
                <ol className="flex h-12 items-end gap-0.5" aria-label={name}>
                  {trend.map((cents, i) => {
                    const label = t("barLabel", { month: monthName(months[i], "long"), amount: formatEuro(cents) });
                    const bar = (
                      <span className="bg-base-200 flex h-12 w-full items-end overflow-hidden rounded-sm">
                        <span className="bg-primary w-full rounded-sm" style={{ height: `${(cents / scale) * 100}%` }} />
                      </span>
                    );
                    const link = href(months[i]);
                    return (
                      <li key={months[i]} className="flex-1" title={label}>
                        {link ? (
                          <Link href={link} aria-label={label} className="block">
                            {bar}
                          </Link>
                        ) : (
                          <span role="img" aria-label={label} className="block">
                            {bar}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
                <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {(
                    [
                      [3, average3Cents],
                      [6, average6Cents],
                      [12, average12Cents],
                    ] as const
                  ).map(([span, cents]) => (
                    <div key={span} className="flex gap-1">
                      <dt className="opacity-70">{t("average", { months: span })}</dt>
                      <dd className="tabular-nums">{formatEuro(cents)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
