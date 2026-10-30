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
import type { StatisticsComparison, StatisticsRow } from "@/insights/server";
import { formatEuro } from "@/shared/money";
import { CategoryTrends } from "./category-trends";
import { MoneyFlow } from "./money-flow";
import { chosenMonth, MonthSwitcher } from "./month-switcher";
import Link from "next/link";
import { bookingsHref } from "@/app/_lib/bookings-href";
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

/**
 * One month (?month=YYYY-MM, default: the current one) of one visible account (?account=<id>) or of
 * all own private accounts (?account=all), with the 12 months up to it.
 */
async function Statistics({ searchParams }: Props) {
  const { caller } = await requireCaller("/sign-in");
  if (!(await households.getHousehold(caller))) redirect("/household/new");
  const query = await searchParams;
  // The same choice as the dashboard: only accounts the caller may see.
  const visibleAccounts = await accounts.listAccounts(caller);
  const selected = selectAccount(visibleAccounts, first(query.account));
  const selectedId = selected === ALL_MINE ? ALL_MINE : (selected?.id ?? "");
  const month = chosenMonth(first(query.month));
  const t = await getTranslations("app.statistics");

  return (
    <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} />
        {selected ? (
          <>
            <ViewTabs view="months" accountId={selectedId} />
            <AccountSwitcher accounts={visibleAccounts} selectedId={selectedId} path="/statistics" params={{ month }} />
            <MonthSwitcher month={month} accountId={selectedId} />
            <MonthSeries caller={caller} accountId={selected === ALL_MINE ? null : selected.id} month={month} />
          </>
        ) : (
          <p className="opacity-70">{t("noAccounts")}</p>
        )}
      </div>
  );
}

/** accountId null: all of the caller's own private accounts together. */
async function MonthSeries({ caller, accountId, month }: { caller: Caller; accountId: string | null; month: string }) {
  const target = accountId ?? ({ ownPrivate: true } as const);
  const [statistics, trends, flow, { names }] = await Promise.all([
    insights.statistics(caller, target, MONTHS, month),
    insights.categoryTrends(caller, target, month),
    insights.moneyFlow(caller, target, month),
    categories.catalog(caller),
  ]);
  if (!statistics.ok) return null;
  const { rows, comparison, running, scaleCents: scale } = statistics;
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const shortName = (m: string) => format.dateTime(monthDate(m), { month: "short", year: "numeric", timeZone: "UTC" });
  const accountParam = accountId ?? ALL_MINE;

  return (
    <>
      <CurrentMonth row={rows[0]} account={accountParam} comparison={comparison} previousMonth={rows[1]?.month} running={running} />
      {flow.ok && <MoneyFlow flow={flow} account={accountParam} categoryNames={names} />}
      {trends.ok && <CategoryTrends trends={trends} account={accountParam} categoryNames={names} />}
      <Section title={t("history", { from: shortName(rows.at(-1)!.month), to: shortName(rows[0].month) })}>
        <ol className="flex flex-col divide-y divide-base-300">
          {rows.map((row) => (
            <MonthRow key={row.month} row={row} scale={scale} href={`/statistics?${new URLSearchParams({ account: accountParam, month: row.month })}`} />
          ))}
        </ol>
      </Section>
    </>
  );
}

/** The first day of a YYYY-MM month as a date, for the month-name formatter. */
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

type Direction = "more" | "less" | "same";
type Tone = "good" | "bad" | "same";
const TONE: Record<Tone, string> = { good: "text-success", bad: "text-error", same: "text-base-content/60" };
const ARROW: Record<Direction, string> = { more: "↑", less: "↓", same: "≈" };

/** Whether more of a figure is good (income, saved, left over, savings rate) or bad (spending). */
const toneOf = (direction: Direction, moreIsGood: boolean): Tone =>
  direction === "same" ? "same" : (direction === "more") === moreIsGood ? "good" : "bad";

type Note = { text: string; tone: Tone; arrow: string };
type Figure = "income" | "spent" | "saved" | "available";

/**
 * The chosen month as figure tiles: income, spending, saved, left over and the savings rate, each
 * compared with the month before and with the usual month (the months before with bookings).
 */
async function CurrentMonth({
  row,
  account,
  comparison,
  previousMonth,
  running,
}: {
  row: StatisticsRow;
  /** An account id or "all". */
  account: string;
  comparison: StatisticsComparison;
  previousMonth: string | undefined;
  running: boolean;
}) {
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const rate = (value: number | null) => (value === null ? t("noRate") : format.number(value, { style: "percent", maximumFractionDigits: 1 }));
  const month = previousMonth ? format.dateTime(monthDate(previousMonth), { month: "long", timeZone: "UTC" }) : "";
  const { previous } = comparison;
  // A usual month made of the month before alone would only repeat the previous line.
  const usual = previous && comparison.usual?.month.months === 1 ? null : comparison.usual;

  /** The two comparison lines of a tile in euros. */
  const moneyNotes = (figure: Figure): Note[] => {
    const moreIsGood = figure !== "spent";
    const notes: Note[] = [];
    if (previous) {
      const { direction, cents } = previous[figure];
      notes.push({
        tone: toneOf(direction, moreIsGood),
        arrow: ARROW[direction],
        text: direction === "same" ? t("previousSame", { month }) : t(direction === "more" ? "previousMore" : "previousLess", { amount: formatEuro(Math.abs(cents)), month }),
      });
    }
    if (usual) {
      const { direction, cents } = usual.changes[figure];
      notes.push({
        tone: toneOf(direction, moreIsGood),
        arrow: ARROW[direction],
        text: direction === "same" ? t("usualSame") : t(direction === "more" ? "usualMore" : "usualLess", { amount: formatEuro(Math.abs(cents)) }),
      });
    }
    return notes;
  };

  const points = (value: number) => format.number(Math.abs(value), { maximumFractionDigits: 1 });
  const rateNotes: Note[] = [];
  if (previous?.savingsRate) {
    const { direction, points: p } = previous.savingsRate;
    rateNotes.push({
      tone: toneOf(direction, true),
      arrow: ARROW[direction],
      text: direction === "same" ? t("previousSame", { month }) : t(direction === "more" ? "pointsMore" : "pointsLess", { points: points(p), month }),
    });
  }
  if (usual?.changes.savingsRate) {
    const { direction, points: p } = usual.changes.savingsRate;
    rateNotes.push({
      tone: toneOf(direction, true),
      arrow: ARROW[direction],
      text: direction === "same" ? t("usualSame") : t(direction === "more" ? "pointsUsualMore" : "pointsUsualLess", { points: points(p) }),
    });
  }

  const bookings = (kind: "expense" | "income" | "saving") => bookingsHref({ account, month: row.month, kind });
  const tiles: { label: string; value: string; notes: Note[]; href?: string; negative?: boolean }[] = [
    { label: t("income"), value: formatEuro(row.incomeCents), notes: moneyNotes("income"), href: bookings("income") },
    { label: t("expenses"), value: formatEuro(-row.expenseCents), notes: moneyNotes("spent"), href: bookings("expense") },
    { label: t("saved"), value: formatEuro(-row.savingCents), notes: moneyNotes("saved"), href: bookings("saving") },
    { label: t("left"), value: formatEuro(row.availableCents), notes: moneyNotes("available"), negative: row.availableCents < 0 },
    { label: t("savingsRate"), value: rate(row.savingsRate), notes: rateNotes },
  ];

  const hints = [
    ...(running ? [t("running")] : []),
    ...(usual ? [t("usualHint", { count: usual.month.months })] : []),
  ];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="sr-only">{t("overview")}</h2>
      <dl className="flex flex-wrap gap-px overflow-hidden rounded-box border border-base-300 bg-base-300">
        {tiles.map(({ label, value, notes, href, negative }) => (
          // A linked tile's link sits in the value and stretches over the whole tile.
          <div
            key={label}
            className={`flex-[1_1_10rem] relative flex min-w-0 flex-col bg-base-100 px-4 py-3 ${href ? "transition-colors has-[a:hover]:bg-base-200" : ""}`}
          >
            <dt className="text-xs leading-snug text-base-content/60">{label}</dt>
            <dd className={`mt-0.5 text-xl font-semibold tracking-tight ${negative ? "text-error" : ""}`}>
              {href ? (
                <Link href={href} className="before:absolute before:inset-0">
                  {value}
                </Link>
              ) : (
                value
              )}
            </dd>
            {notes.map((note, i) => (
              <dd key={i} className={`${i === 0 ? "mt-1" : ""} flex gap-1 text-xs leading-snug ${TONE[note.tone]}`}>
                <span aria-hidden>{note.arrow}</span>
                <span>{note.text}</span>
              </dd>
            ))}
          </div>
        ))}
      </dl>
      {hints.length > 0 && <p className="text-xs text-base-content/60">{hints.join(" ")}</p>}
    </section>
  );
}

async function MonthRow({ row, scale, href }: { row: StatisticsRow; scale: number; href: string }) {
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const name = format.dateTime(monthDate(row.month), { month: "long", year: "numeric", timeZone: "UTC" });
  const spent = -row.expenseCents;
  const extras: [string, string][] = [
    [t("saved"), formatEuro(-row.savingCents)],
    [t("left"), formatEuro(row.availableCents)],
    [t("savingsRate"), row.savingsRate === null ? t("noRate") : format.number(row.savingsRate, { style: "percent", maximumFractionDigits: 1 })],
  ];

  return (
    // Months without bookings stay in the list but recede.
    <li className={`flex flex-col gap-2 py-4 first:pt-1 ${row.incomeCents === 0 && spent === 0 ? "opacity-45" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold">
          <Link href={href} className="link link-hover">
            {name}
          </Link>
        </h3>
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
