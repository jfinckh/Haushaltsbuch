import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountSwitcher } from "@/app/_lib/account-switcher";
import { accounts } from "@/app/_lib/accounts";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { categories } from "@/app/_lib/categories";
import { insights } from "@/app/_lib/insights";
import { ALL_MINE, selectAccount } from "@/insights";
import type { StatisticsRow } from "@/insights/server";
import { formatEuro } from "@/shared/money";
import { CategoryTrends } from "./category-trends";
import { ViewTabs } from "./view-tabs";
import type { Caller } from "@/shared/rls";
import { AppShell, PageHeader, Section } from "@/app/_lib/app-shell";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** How many calendar months the page shows, including the current one. */
const MONTHS = 12;

export default function StatisticsPage(props: Props) {
  return (
    <AppShell>
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Statistics {...props} />
      </Suspense>
    </AppShell>
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
    <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} />
        {selected ? (
          <>
            <ViewTabs view="months" accountId={selected === ALL_MINE ? ALL_MINE : selected.id} />
            <AccountSwitcher accounts={visibleAccounts} selectedId={selected === ALL_MINE ? ALL_MINE : selected.id} path="/statistics" />
            <MonthSeries caller={caller} accountId={selected === ALL_MINE ? null : selected.id} />
          </>
        ) : (
          <p className="opacity-70">{t("noAccounts")}</p>
        )}
      </div>
  );
}

/** accountId null: all of the caller's own private accounts, with the contribution to shared accounts. */
async function MonthSeries({ caller, accountId }: { caller: Caller; accountId: string | null }) {
  const target = accountId ?? ({ ownPrivate: true } as const);
  const [statistics, trends, { names }] = await Promise.all([
    insights.statistics(caller, target, MONTHS),
    insights.categoryTrends(caller, target),
    categories.catalog(caller),
  ]);
  if (!statistics.ok) return null;
  const { rows, comparison, scaleCents: scale } = statistics;
  const t = await getTranslations("app.statistics");

  return (
    <>
      <CurrentMonth row={rows[0]} comparison={comparison} previousMonth={rows[1]?.month} />
      {trends.ok && <CategoryTrends trends={trends} accountId={accountId} categoryNames={names} />}
      <Section title={t("byMonth")}>
        <ol className="flex flex-col divide-y divide-base-300">
          {rows.map((row) => (
            <MonthRow key={row.month} row={row} scale={scale} />
          ))}
        </ol>
      </Section>
    </>
  );
}

/** The first day of a YYYY-MM month as a date, for the month-name formatter. */
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

type MonthComparison = { expenseChangeCents: number; savingsRateChangePoints: number | null };

type Tone = "good" | "bad" | "same";
const TONE: Record<Tone, string> = { good: "text-success", bad: "text-error", same: "text-base-content/60" };
const ARROW: Record<Tone, string> = { good: "↓", bad: "↑", same: "=" };

/** The current month as figure tiles; spending and savings rate compared with the month before. */
async function CurrentMonth({
  row,
  comparison,
  previousMonth,
}: {
  row: StatisticsRow;
  comparison: MonthComparison | null;
  previousMonth: string | undefined;
}) {
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const name = format.dateTime(monthDate(row.month), { month: "long", year: "numeric", timeZone: "UTC" });
  const rate = (value: number | null) => (value === null ? t("noRate") : format.number(value, { style: "percent", maximumFractionDigits: 1 }));

  let expenseNote: { text: string; tone: Tone; arrow: string } | null = null;
  let rateNote: { text: string; tone: Tone; arrow: string } | null = null;
  if (comparison && previousMonth) {
    const month = format.dateTime(monthDate(previousMonth), { month: "long", timeZone: "UTC" });
    const { expenseChangeCents: change, savingsRateChangePoints: points } = comparison;
    const expenseTone: Tone = change === 0 ? "same" : change > 0 ? "bad" : "good";
    expenseNote = {
      tone: expenseTone,
      arrow: ARROW[expenseTone],
      text:
        change === 0
          ? t("expensesSame", { month })
          : t(change > 0 ? "expensesMore" : "expensesLess", { amount: formatEuro(Math.abs(change)), month }),
    };
    if (points !== null) {
      const rateTone: Tone = points === 0 ? "same" : points > 0 ? "good" : "bad";
      rateNote = {
        tone: rateTone,
        arrow: points === 0 ? "=" : points > 0 ? "↑" : "↓",
        text:
          points === 0
            ? t("rateSame", { month })
            : t(points > 0 ? "rateUp" : "rateDown", { points: format.number(Math.abs(points), { maximumFractionDigits: 1 }), month }),
      };
    }
  }

  const tiles: { label: string; value: string; note?: typeof expenseNote }[] = [
    { label: t("expenses"), value: formatEuro(-row.expenseCents), note: expenseNote },
    { label: t("income"), value: formatEuro(row.incomeCents) },
    { label: t("saved"), value: formatEuro(-row.savingCents) },
    { label: t("savingsRate"), value: rate(row.savingsRate), note: rateNote },
    ...(row.contributionCents === null ? [] : [{ label: t("contribution"), value: formatEuro(row.contributionCents) }]),
  ];

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{comparison ? t("comparison") : name}</h2>
      <dl className="flex flex-wrap gap-px overflow-hidden rounded-box border border-base-300 bg-base-300">
        {tiles.map(({ label, value, note }) => (
          <div key={label} className="flex-[1_1_9rem] flex min-w-0 flex-col bg-base-100 px-4 py-3">
            <dt className="text-xs leading-snug text-base-content/60">{label}</dt>
            <dd className="mt-0.5 text-xl font-semibold tracking-tight">{value}</dd>
            {note && (
              <dd className={`mt-1 flex gap-1 text-xs leading-snug ${TONE[note.tone]}`}>
                <span aria-hidden>{note.arrow}</span>
                <span>{note.text}</span>
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

async function MonthRow({ row, scale }: { row: StatisticsRow; scale: number }) {
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const name = format.dateTime(monthDate(row.month), { month: "long", year: "numeric", timeZone: "UTC" });
  const spent = -row.expenseCents;
  const extras: [string, string][] = [
    [t("saved"), formatEuro(-row.savingCents)],
    [t("savingsRate"), row.savingsRate === null ? t("noRate") : format.number(row.savingsRate, { style: "percent", maximumFractionDigits: 1 })],
    ...(row.contributionCents === null ? [] : ([[t("contribution"), formatEuro(row.contributionCents)]] as [string, string][])),
  ];

  return (
    // Months without bookings stay in the list but recede.
    <li className={`flex flex-col gap-2 py-4 first:pt-1 ${row.incomeCents === 0 && spent === 0 ? "opacity-45" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold">{name}</h3>
        <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
          {extras.map(([label, value]) => (
            <div key={label} className="flex gap-1">
              <dt className="text-base-content/60">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex flex-col gap-1.5">
        <Bar label={t("income")} cents={row.incomeCents} scale={scale} color="bg-success" />
        <Bar label={t("expenses")} cents={spent} scale={scale} color="bg-error" />
      </div>
    </li>
  );
}

/** One horizontal bar: label, a track filled to cents / scale, the amount. */
function Bar({ label, cents, scale, color }: { label: string; cents: number; scale: number; color: string }) {
  const percent = Math.min(100, (Math.max(0, cents) / scale) * 100);
  return (
    // Fixed label and amount columns, so every month's bar track has the same width and bars compare.
    <div className="grid grid-cols-[5.5rem_1fr_6.5rem] items-center gap-3 text-sm">
      <span className="text-base-content/60">{label}</span>
      <div className="h-2.5 overflow-hidden rounded-full bg-base-200" aria-hidden>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-right">{formatEuro(cents)}</span>
    </div>
  );
}
