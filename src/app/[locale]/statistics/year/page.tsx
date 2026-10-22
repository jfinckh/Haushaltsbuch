import Link from "next/link";
import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountSwitcher } from "@/app/_lib/account-switcher";
import { accounts } from "@/app/_lib/accounts";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { insights } from "@/app/_lib/insights";
import { ALL_MINE, selectAccount } from "@/insights";
import type { Insights } from "@/insights/server";
import { formatCents, formatEuro } from "@/shared/money";
import type { Caller } from "@/shared/rls";
import { useCategoryName } from "@/transactions";
import { ViewTabs } from "../view-tabs";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

type Overview = Extract<Awaited<ReturnType<Insights["yearOverview"]>>, { ok: true }>;

/** The earliest year the switcher links to (the overview accepts nothing earlier). */
const FIRST_YEAR = 1970;

export default function YearPage(props: Props) {
  return (
    <main className="flex flex-1 items-start justify-center p-4">
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Year {...props} />
      </Suspense>
    </main>
  );
}

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
    <div className="card bg-base-100 w-full max-w-md shadow-md">
      <div className="card-body gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="card-title text-2xl">{t("title")}</h1>
          <Link href={selected ? `/?account=${selectedId}` : "/"} className="btn btn-ghost btn-sm">
            {t("back")}
          </Link>
        </div>
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
    </div>
  );
}

/** accountId null: all of the caller's own private accounts, with the contribution to shared accounts. */
async function YearFigures({ caller, accountId, year }: { caller: Caller; accountId: string | null; year: number }) {
  const overview = await insights.yearOverview(caller, accountId ?? { ownPrivate: true }, year);
  if (!overview.ok) return null;
  return (
    <>
      <Totals overview={overview} />
      <div className="divider my-0" />
      <MonthTable overview={overview} />
      <div className="divider my-0" />
      <YearCategories categories={overview.categories} />
    </>
  );
}

async function Totals({ overview: { totals } }: { overview: Overview }) {
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const figures: [string, string][] = [
    [t("income"), formatEuro(totals.incomeCents)],
    [t("expenses"), formatEuro(-totals.expenseCents)],
    [t("saved"), formatEuro(-totals.savingCents)],
    [t("savingsRate"), totals.savingsRate === null ? t("noRate") : format.number(totals.savingsRate, { style: "percent", maximumFractionDigits: 1 })],
    ...(totals.contributionCents === null ? [] : ([[t("contribution"), formatEuro(totals.contributionCents)]] as [string, string][])),
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm">
      {figures.map(([label, value]) => (
        <div key={label}>
          <dt className="opacity-70">{label}</dt>
          <dd className="text-base tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One row per month, January first, and the year's totals at the bottom. */
async function MonthTable({ overview: { months, totals } }: { overview: Overview }) {
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const withContribution = totals.contributionCents !== null;
  const rate = (value: number | null) => (value === null ? t("noRate") : format.number(value, { style: "percent", maximumFractionDigits: 1 }));
  const cells = (row: { incomeCents: number; expenseCents: number; savingCents: number; savingsRate: number | null; contributionCents: number | null }) => (
    <>
      <td className="text-right">{formatCents(row.incomeCents)}</td>
      <td className="text-right">{formatCents(-row.expenseCents)}</td>
      <td className="text-right">{formatCents(-row.savingCents)}</td>
      <td className="text-right">{rate(row.savingsRate)}</td>
      {withContribution && <td className="text-right">{formatCents(row.contributionCents ?? 0)}</td>}
    </>
  );
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("byMonth")}</h2>
        <span className="text-xs opacity-70">{t("amountsInEuro")}</span>
      </div>
      {/* Fits a phone; only the table would scroll sideways on an even narrower screen. */}
      <div className="-mx-4 overflow-x-auto">
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
              {withContribution && (
                <th className="text-right">
                  <abbr title={t("contribution")} className="no-underline">{t("contributionShort")}</abbr>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {months.map((row) => (
              <tr key={row.month}>
                <th className="font-normal">{format.dateTime(new Date(`${row.month}-01T00:00:00Z`), { month: "short", timeZone: "UTC" })}</th>
                {cells(row)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>{t("total")}</th>
              {cells(totals)}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** The year's spending per category group with its share of the total. */
function YearCategories({ categories: { totalCents, groups } }: { categories: Overview["categories"] }) {
  const t = useTranslations("app.statistics");
  const uncategorized = useTranslations("transactions.spending")("uncategorized");
  const categoryName = useCategoryName();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t("categories")}</h2>
      {groups.length === 0 ? (
        <p className="text-sm opacity-70">{t("noYearSpending")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.map(({ group, cents }) => {
            const name = group ? categoryName(group) : uncategorized;
            return (
              <li key={group ?? ""} className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium">{name}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatEuro(cents)} <span className="opacity-70">· {t("share", { percent: Math.round((cents * 100) / totalCents) })}</span>
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
