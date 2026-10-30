import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { bookingsHref } from "@/app/_lib/bookings-href";
import { formatEuro } from "@/shared/money";
import { useCategoryName } from "@/transactions";

/** One compared month's spending per category group (positive cents). */
export type MonthGroups = { month: string; groups: { group: string | null; cents: number }[] };

/** One colour per month position, so a month keeps its colour in every group. */
const BAR = ["progress-primary", "progress-secondary", "progress-accent"];

/**
 * Spending per category group in several months: one bar per month under each group, all on one
 * scale (the largest amount fills a bar), so the months compare directly. Groups are sorted by the
 * main month's amount. Each month's amount links to its bookings of that group.
 */
export function CategoryCompare({
  months,
  main,
  account,
  categoryNames,
}: {
  /** The compared months, newest first. */
  months: MonthGroups[];
  /** The main month (YYYY-MM), which sets the order. */
  main: string;
  /** An account id or "all". */
  account: string;
  /** Names of own categories (the page's catalog). */
  categoryNames: Record<string, string>;
}) {
  const t = useTranslations("app.statistics");
  const uncategorized = useTranslations("transactions.spending")("uncategorized");
  const categoryName = useCategoryName(categoryNames);
  const format = useFormatter();
  const monthName = (m: string) => format.dateTime(new Date(`${m}-01T00:00:00Z`), { month: "short", year: "numeric", timeZone: "UTC" });

  // Refunds can make a group negative; such a month shows no bar.
  const centsOf = (m: MonthGroups, group: string | null) => Math.max(0, m.groups.find((g) => g.group === group)?.cents ?? 0);
  const totals = months.map((m) => m.groups.reduce((sum, g) => sum + Math.max(0, g.cents), 0));
  const mainMonth = months.find((m) => m.month === main) ?? months[0];
  const keys = [...new Set(months.flatMap((m) => m.groups.map((g) => g.group)))]
    .filter((group) => months.some((m) => centsOf(m, group) > 0))
    .sort(
      (a, b) =>
        centsOf(mainMonth, b) - centsOf(mainMonth, a) ||
        months.reduce((sum, m) => sum + centsOf(m, b) - centsOf(m, a), 0),
    );
  const scale = Math.max(1, ...months.flatMap((m) => m.groups.map((g) => g.cents)));

  return (
    <section className="flex min-w-0 flex-col gap-3 border-t border-base-300 pt-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold">{t("categoriesCompare")}</h2>
        <p className="text-sm text-base-content/60">{t("categoriesCompareHint")}</p>
      </div>
      {keys.length === 0 ? (
        <p className="text-sm text-base-content/60">{t("noCompareSpending")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-base-300">
          {keys.map((group) => {
            const label = group ? categoryName(group) : uncategorized;
            return (
              <li key={group ?? ""} className="flex flex-col gap-1.5 py-3">
                <h3 className="min-w-0 truncate text-sm font-medium">{label}</h3>
                {months.map((m, i) => {
                  const cents = centsOf(m, group);
                  const share = totals[i] > 0 ? Math.round((cents * 100) / totals[i]) : 0;
                  return (
                    <div key={m.month} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-xs sm:grid-cols-[5.5rem_1fr_9rem]">
                      <span className="text-base-content/60">{monthName(m.month)}</span>
                      <progress
                        className={`progress ${BAR[i % BAR.length]} h-2 w-full`}
                        value={cents}
                        max={scale}
                        aria-label={`${label}, ${monthName(m.month)}: ${formatEuro(cents)}`}
                      />
                      <span className="text-right tabular-nums">
                        <Link href={bookingsHref({ account, month: m.month, kind: "expense", category: group })} className="link link-hover font-medium">
                          {formatEuro(cents)}
                        </Link>{" "}
                        <span className="text-base-content/50">· {t("share", { percent: share })}</span>
                      </span>
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
