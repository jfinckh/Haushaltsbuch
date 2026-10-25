import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { Insights } from "@/insights/server";
import { formatEuro } from "@/shared/money";
import { useCategoryName } from "@/transactions";

type Trends = Extract<Awaited<ReturnType<Insights["categoryTrends"]>>, { ok: true }>;

/** The first day of a YYYY-MM month as a date, for the month-name formatter. */
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

/** Name and amount, this month's bar against the 3-month average, the 12-month line (wide screens). */
const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_7rem_6rem]";

/**
 * Spending per category group this month, on one scale for all groups, with the average of the last
 * three complete months as a marker, and the last 12 months as a small line.
 * With an account, the name links to that account's bookings of the month and group.
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
  const currentMonth = months.at(-1)!;
  const currentName = format.dateTime(monthDate(currentMonth), { month: "long", timeZone: "UTC" });
  const averageLabel = t("average", { months: 3 });
  // One scale for every row, so the bars compare across categories.
  const scale = Math.max(1, ...groups.flatMap((g) => [g.trend.at(-1) ?? 0, g.average3Cents]));
  const percent = (cents: number) => Math.min(100, (Math.max(0, cents) / scale) * 100);

  return (
    <section className="flex min-w-0 flex-col gap-3 border-t border-base-300 pt-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold">{t("categories")}</h2>
        <p className="text-sm text-base-content/60">
          {t("categoriesHint", { from: monthName(months[0], "short"), to: monthName(currentMonth, "short") })}
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-base-content/60">{t("noCategorySpending")}</p>
      ) : (
        <div className="flex flex-col">
          {/* Legend and column heads. */}
          <div className={`${ROW} border-b border-base-300 pb-2 text-xs text-base-content/60`}>
            <span className="hidden sm:block" />
            <span className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 sm:col-span-1">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-[2px] bg-primary" aria-hidden />
                {currentName}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-0.5 rounded-full bg-base-content/70" aria-hidden />
                {averageLabel}
              </span>
            </span>
            <span className="hidden text-right sm:block" />
            <span className="hidden text-right sm:block">{t("tabMonths")}</span>
          </div>
          <ul className="flex flex-col divide-y divide-base-300">
            {groups.map(({ group, trend, average3Cents }) => {
              const name = group ? categoryName(group) : uncategorized;
              const currentCents = trend.at(-1) ?? 0;
              // No filter exists for bookings without category, and several accounts have no single list.
              const href =
                accountId && group
                  ? `/accounts/${accountId}?${new URLSearchParams({ month: currentMonth, kind: "expense", category: group })}`
                  : null;
              const summary = `${name}: ${currentName} ${formatEuro(currentCents)}, ${averageLabel} ${formatEuro(average3Cents)}`;
              return (
                <li key={group ?? ""} className={`${ROW} py-3`}>
                  <h3 className="min-w-0 truncate text-sm font-medium">
                    {href ? (
                      <Link href={href} className="link link-hover">
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </h3>
                  {/* This month's bar; the vertical mark is the 3-month average. */}
                  <div
                    role="img"
                    aria-label={summary}
                    title={summary}
                    className="relative col-span-2 col-start-1 row-start-2 flex h-4 items-center sm:col-span-1 sm:col-start-auto sm:row-start-auto"
                  >
                    <span className="absolute inset-x-0 top-1/2 h-px bg-base-300" aria-hidden />
                    {currentCents > 0 && (
                      <span className="relative h-2 min-w-[3px] rounded-r-[4px] bg-primary" style={{ width: `${percent(currentCents)}%` }} />
                    )}
                    {average3Cents > 0 && (
                      <span
                        className="absolute top-0 h-4 w-0.5 -translate-x-1/2 rounded-full bg-base-content/70"
                        style={{ left: `${percent(average3Cents)}%` }}
                        aria-hidden
                      />
                    )}
                  </div>
                  <div className="text-right leading-tight">
                    <div className="text-sm font-medium">{formatEuro(currentCents)}</div>
                    <div className="text-xs text-base-content/60">Ø {formatEuro(average3Cents)}</div>
                  </div>
                  <Sparkline values={trend} label={`${name}: ${t("tabMonths")}`} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/** 12 months as a thin line, the current month as a dot. Hidden on phones. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const width = 96;
  const height = 28;
  const pad = 4;
  const max = Math.max(1, ...values);
  const points = values.map((cents, i) => {
    const x = pad + (i * (width - 2 * pad)) / Math.max(1, values.length - 1);
    const y = height - pad - (Math.max(0, cents) / max) * (height - 2 * pad);
    return [x, y] as const;
  });
  const [lastX, lastY] = points.at(-1)!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="hidden h-7 w-24 justify-self-end overflow-visible sm:block" role="img" aria-label={label}>
      <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className="stroke-base-300" strokeWidth={1} />
      <polyline
        points={points.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        className="stroke-base-content/40"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={3} className="fill-primary stroke-base-100" strokeWidth={2} />
    </svg>
  );
}
