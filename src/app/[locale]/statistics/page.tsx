import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountSwitcher } from "@/app/_lib/account-switcher";
import { accounts } from "@/app/_lib/accounts";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { ALL_MINE, selectAccount } from "@/app/_lib/select-account";
import { barScale, compareMonths, statisticsRows, type StatisticsRow } from "@/app/_lib/statistics";
import { transactions } from "@/app/_lib/transactions";
import { transfers } from "@/app/_lib/transfers";
import { formatEuro } from "@/shared/money";
import type { Caller } from "@/shared/rls";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** How many calendar months the page shows, including the current one. */
const MONTHS = 12;

export default function StatisticsPage(props: Props) {
  return (
    <main className="flex flex-1 items-start justify-center p-4">
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Statistics {...props} />
      </Suspense>
    </main>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The last 12 months of one visible account (?account=<id>) or of all own private accounts (?account=all). */
async function Statistics({ searchParams }: Props) {
  const { caller } = await requireCaller("/sign-in");
  if (!(await households.getHousehold(caller))) redirect("/household/new");
  // The same choice as the dashboard: only accounts the caller may see.
  const visibleAccounts = await accounts.listAccounts(caller);
  const selected = selectAccount(visibleAccounts, first((await searchParams).account));
  const t = await getTranslations("app.statistics");

  return (
    <div className="card bg-base-100 w-full max-w-md shadow-md">
      <div className="card-body gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="card-title text-2xl">{t("title")}</h1>
          <Link href={selected ? `/?account=${selected === ALL_MINE ? ALL_MINE : selected.id}` : "/"} className="btn btn-ghost btn-sm">
            {t("back")}
          </Link>
        </div>
        {selected ? (
          <>
            <AccountSwitcher accounts={visibleAccounts} selectedId={selected === ALL_MINE ? ALL_MINE : selected.id} path="/statistics" />
            <MonthSeries caller={caller} accountId={selected === ALL_MINE ? null : selected.id} />
          </>
        ) : (
          <p className="opacity-70">{t("noAccounts")}</p>
        )}
      </div>
    </div>
  );
}

/** accountId null: all of the caller's own private accounts, with the contribution to shared accounts. */
async function MonthSeries({ caller, accountId }: { caller: Caller; accountId: string | null }) {
  const summaries = await transactions.monthSummaries(caller, accountId ?? { ownPrivate: true }, MONTHS);
  if (!summaries.ok) return null;
  const newest = summaries.months[0].month;
  const oldest = summaries.months.at(-1)!.month;
  const contributions = accountId === null ? await transfers.sharedContributions(caller, oldest, newest) : null;
  if (contributions && !contributions.ok) return null;
  const rows = statisticsRows(summaries.months, contributions?.months);
  const scale = barScale(rows);

  return (
    <>
      <Comparison current={rows[0]} previous={rows[1]} />
      <div className="divider my-0" />
      <ol className="flex flex-col gap-4">
        {rows.map((row) => (
          <MonthRow key={row.month} row={row} scale={scale} />
        ))}
      </ol>
    </>
  );
}

/** The first day of a YYYY-MM month as a date, for the month-name formatter. */
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

async function Comparison({ current, previous }: { current: StatisticsRow; previous: StatisticsRow }) {
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const { expenseChangeCents, savingsRateChangePoints } = compareMonths(current, previous);
  const previousName = format.dateTime(monthDate(previous.month), { month: "long", timeZone: "UTC" });
  const points = (value: number) => format.number(Math.abs(value), { maximumFractionDigits: 1 });

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold">{t("comparison")}</h2>
      <p className="text-sm">
        {expenseChangeCents === 0
          ? t("expensesSame", { month: previousName })
          : t(expenseChangeCents > 0 ? "expensesMore" : "expensesLess", { amount: formatEuro(Math.abs(expenseChangeCents)), month: previousName })}
      </p>
      {savingsRateChangePoints !== null && (
        <p className="text-sm">
          {savingsRateChangePoints === 0
            ? t("rateSame", { month: previousName })
            : t(savingsRateChangePoints > 0 ? "rateUp" : "rateDown", { points: points(savingsRateChangePoints), month: previousName })}
        </p>
      )}
    </section>
  );
}

async function MonthRow({ row, scale }: { row: StatisticsRow; scale: number }) {
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const name = format.dateTime(monthDate(row.month), { month: "long", year: "numeric", timeZone: "UTC" });
  const spent = -row.expenseCents;

  return (
    <li className="flex flex-col gap-1">
      <h3 className="font-semibold">{name}</h3>
      <Bar label={t("income")} cents={row.incomeCents} scale={scale} color="bg-success" />
      <Bar label={t("expenses")} cents={spent} scale={scale} color="bg-error" />
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <div className="flex gap-1">
          <dt className="opacity-70">{t("saved")}</dt>
          <dd className="tabular-nums">{formatEuro(-row.savingCents)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="opacity-70">{t("savingsRate")}</dt>
          <dd className="tabular-nums">
            {row.savingsRate === null ? t("noRate") : format.number(row.savingsRate, { style: "percent", maximumFractionDigits: 1 })}
          </dd>
        </div>
        {row.contributionCents !== null && (
          <div className="flex gap-1">
            <dt className="opacity-70">{t("contribution")}</dt>
            <dd className="tabular-nums">{formatEuro(row.contributionCents)}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

/** One horizontal bar: label, a track filled to cents / scale, the amount. */
function Bar({ label, cents, scale, color }: { label: string; cents: number; scale: number; color: string }) {
  const percent = Math.min(100, (Math.max(0, cents) / scale) * 100);
  return (
    // Fixed label and amount columns, so every month's bar track has the same width and bars compare.
    <div className="grid grid-cols-[5.5rem_1fr_6.5rem] items-center gap-2 text-sm">
      <span className="opacity-70">{label}</span>
      <div className="bg-base-200 h-3 overflow-hidden rounded-full" aria-hidden>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-right tabular-nums">{formatEuro(cents)}</span>
    </div>
  );
}
