import Link from "next/link";
import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { bookingsHref } from "@/app/_lib/bookings-href";
import { AccountSwitcher } from "@/app/_lib/account-switcher";
import { accounts } from "@/app/_lib/accounts";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { categories as categoryService } from "@/app/_lib/categories";
import { insights } from "@/app/_lib/insights";
import { ALL_MINE, selectAccount } from "@/insights";
import type { YearOverview as Overview } from "@/insights/server";
import { formatCents, formatEuro } from "@/shared/money";
import type { Caller } from "@/shared/rls";
import { useCategoryName } from "@/transactions";
import { ViewTabs } from "../view-tabs";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The earliest year the switcher links to (the overview accepts nothing earlier). */
const FIRST_YEAR = 1970;

export default function YearPage(props: Props) {
  return (
    <AppShell>
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Year {...props} />
      </Suspense>
    </AppShell>
  );
}

/** The address of the year view, so bookings opened from it link back. */
const yearOrigin = (account: string, year: number) => `/statistics/year?${new URLSearchParams({ account, year: String(year) })}`;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** One calendar year of one visible account (?account=<id>) or of all own private accounts (?account=all). */
async function Year({ searchParams }: Props) {
  const { caller } = await requireCaller("/sign-in");
  if (!(await households.getHousehold(caller))) redirect("/household/new");
  const query = await searchParams;
  // The same choice as the dashboard: only accounts the caller may see.
  const visibleAccounts = await accounts.listAccounts(caller);
  const selected = selectAccount(visibleAccounts, first(query.account));
  const selectedId = selected === ALL_MINE ? ALL_MINE : (selected?.id ?? "");
  // A missing, malformed or future year falls back to the current one.
  const currentYear = new Date().getFullYear();
  const asked = Number(first(query.year));
  const year = Number.isInteger(asked) && asked >= FIRST_YEAR && asked <= currentYear ? asked : currentYear;
  const t = await getTranslations("app.statistics");

  return (
    <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} />
        {selected ? (
          <>
            <ViewTabs view="year" accountId={selectedId} />
            <AccountSwitcher accounts={visibleAccounts} selectedId={selectedId} path="/statistics/year" params={{ year: String(year) }} />
            <nav aria-label={t("yearSwitcher")} className="flex items-center justify-between">
              {year > FIRST_YEAR ? (
                <Link href={`/statistics/year?account=${selectedId}&year=${year - 1}`} className="btn btn-ghost btn-sm" aria-label={t("previousYear")}>
                  ‹ {year - 1}
                </Link>
              ) : (
                <span />
              )}
              <h2 className="text-lg font-semibold tabular-nums">{t("yearTitle", { year })}</h2>
              {year < currentYear ? (
                <Link href={`/statistics/year?account=${selectedId}&year=${year + 1}`} className="btn btn-ghost btn-sm" aria-label={t("nextYear")}>
                  {year + 1} ›
                </Link>
              ) : (
                <span className="w-16" />
              )}
            </nav>
            <YearFigures caller={caller} accountId={selected === ALL_MINE ? null : selected.id} year={year} />
          </>
        ) : (
          <p className="opacity-70">{t("noAccounts")}</p>
        )}
      </div>
  );
}

/** accountId null: all of the caller's own private accounts together. */
async function YearFigures({ caller, accountId, year }: { caller: Caller; accountId: string | null; year: number }) {
  const [overview, { names }] = await Promise.all([
    insights.yearOverview(caller, accountId ?? { ownPrivate: true }, year),
    categoryService.catalog(caller),
  ]);
  if (!overview.ok) return null;
  const account = accountId ?? ALL_MINE;
  return (
    <>
      <Totals overview={overview} account={account} year={year} />
      <MonthTable overview={overview} account={account} year={year} />
      <YearCategories categories={overview.categories} categoryNames={names} account={account} year={year} />
    </>
  );
}

async function Totals({ overview: { totals }, account, year }: { overview: Overview; account: string; year: number }) {
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const bookings = (kind: "expense" | "income" | "saving") => bookingsHref({ account, year, kind, origin: yearOrigin(account, year) });
  const figures: [string, string, string?][] = [
    [t("income"), formatEuro(totals.incomeCents), bookings("income")],
    [t("expenses"), formatEuro(-totals.expenseCents), bookings("expense")],
    [t("saved"), formatEuro(-totals.savingCents), bookings("saving")],
    [t("savingsRate"), totals.savingsRate === null ? t("noRate") : format.number(totals.savingsRate, { style: "percent", maximumFractionDigits: 1 })],
  ];
  return (
    <dl className="flex flex-wrap gap-px overflow-hidden rounded-box border border-base-300 bg-base-300">
      {figures.map(([label, value, href]) => (
        // A linked tile's link sits in the value and stretches over the whole tile.
        <div
          key={label}
          className={`flex-[1_1_9rem] relative min-w-0 bg-base-100 px-4 py-3 ${href ? "transition-colors has-[a:hover]:bg-base-200" : ""}`}
        >
          <dt className="text-xs leading-snug text-base-content/60">{label}</dt>
          <dd className="mt-0.5 text-xl font-semibold tracking-tight">
            {href ? (
              <Link href={href} className="before:absolute before:inset-0">
                {value}
              </Link>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One row per month, January first, and the year's totals at the bottom. */
async function MonthTable({ overview: { months, totals }, account, year }: { overview: Overview; account: string; year: number }) {
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const rate = (value: number | null) => (value === null ? t("noRate") : format.number(value, { style: "percent", maximumFractionDigits: 1 }));
  // The amounts link to the bookings of the month, or of the year for the totals row.
  const amount = (cents: number, kind: "expense" | "income" | "saving", period: { month: string } | { year: number }) => (
    <Link href={bookingsHref({ account, ...period, kind, origin: yearOrigin(account, year) })} className="link decoration-base-content/30 underline-offset-2">
      {formatCents(cents)}
    </Link>
  );
  const cells = (
    row: { incomeCents: number; expenseCents: number; savingCents: number; savingsRate: number | null },
    period: { month: string } | { year: number },
  ) => (
    <>
      <td className="text-right">{amount(row.incomeCents, "income", period)}</td>
      <td className="text-right">{amount(-row.expenseCents, "expense", period)}</td>
      <td className="text-right">{amount(-row.savingCents, "saving", period)}</td>
      <td className="text-right">{rate(row.savingsRate)}</td>
    </>
  );
  return (
    <section className="flex min-w-0 flex-col gap-3 border-t border-base-300 pt-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("byMonth")}</h2>
        <span className="text-xs text-base-content/50">{t("amountsInEuro")}</span>
      </div>
      {/* Fits a phone; only the table would scroll sideways on an even narrower screen. */}
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="table-xs table w-full tabular-nums [&_td]:px-1 [&_th]:px-1 [&_tfoot]:text-xs">
          <thead>
            <tr>
              <th>{t("month")}</th>
              <th className="text-right">
                <abbr title={t("income")} className="no-underline">{t("incomeShort")}</abbr>
              </th>
              <th className="text-right">
                <abbr title={t("expenses")} className="no-underline">{t("expensesShort")}</abbr>
              </th>
              <th className="text-right">
                <abbr title={t("saved")} className="no-underline">{t("savedShort")}</abbr>
              </th>
              <th className="text-right">
                <abbr title={t("savingsRate")} className="no-underline">{t("rateShort")}</abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((row) => (
              <tr key={row.month}>
                <th className="font-normal">{format.dateTime(new Date(`${row.month}-01T00:00:00Z`), { month: "short", timeZone: "UTC" })}</th>
                {cells(row, { month: row.month })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>{t("total")}</th>
              {cells(totals, { year })}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** The year's spending per category group with its share of the total. */
function YearCategories({
  categories: { totalCents, groups },
  categoryNames,
  account,
  year,
}: {
  account: string;
  year: number;
  categories: Overview["categories"];
  /** Names of own categories (the page's catalog). */
  categoryNames: Record<string, string>;
}) {
  const t = useTranslations("app.statistics");
  const uncategorized = useTranslations("transactions.spending")("uncategorized");
  const categoryName = useCategoryName(categoryNames);
  return (
    <section className="flex min-w-0 flex-col gap-3 border-t border-base-300 pt-5">
      <h2 className="text-lg font-semibold">{t("categories")}</h2>
      {groups.length === 0 ? (
        <p className="text-sm text-base-content/60">{t("noYearSpending")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map(({ group, cents }) => {
            const name = group ? categoryName(group) : uncategorized;
            return (
              <li key={group ?? ""} className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium">
                    <Link href={bookingsHref({ account, year, kind: "expense", category: group, origin: yearOrigin(account, year) })} className="link link-hover">
                      {name}
                    </Link>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatEuro(cents)} <span className="text-base-content/50">· {t("share", { percent: Math.round((cents * 100) / totalCents) })}</span>
                  </span>
                </span>
                <progress className="progress progress-primary w-full" value={cents} max={totalCents} aria-label={name} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
