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
import { CategoryCompare } from "./category-compare";
import { CategoryTrends } from "./category-trends";
import { chosenCompare, compareParams, shownMonths, statisticsHref } from "./compare-months";
import { ComparePicker } from "./compare-picker";
import { MoneyFlow } from "./money-flow";
import { chosenMonth, currentMonth, MonthSwitcher, shiftMonth, yearChoices } from "./month-switcher";
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
 * all own private accounts (?account=all), with the 12 months up to it. Up to two more months
 * (?compare=YYYY-MM,YYYY-MM) are shown next to it in every section.
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
  const compare = chosenCompare(first(query.compare), month, currentMonth());
  const t = await getTranslations("app.statistics");

  return (
    <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} />
        {selected ? (
          <>
            <ViewTabs view="months" accountId={selectedId} />
            <AccountSwitcher accounts={visibleAccounts} selectedId={selectedId} path="/statistics" params={{ month, ...compareParams(compare) }} />
            <MonthSwitcher month={month} accountId={selectedId} compare={compare} />
            <CompareBar month={month} compare={compare} accountId={selectedId} />
            <MonthSeries caller={caller} accountId={selected === ALL_MINE ? null : selected.id} month={month} compare={compare} />
          </>
        ) : (
          <p className="opacity-70">{t("noAccounts")}</p>
        )}
      </div>
  );
}

/** The compared months as chips and the lists to add one. */
async function CompareBar({ month, compare, accountId }: { month: string; compare: string[]; accountId: string }) {
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const current = currentMonth();
  const shown = shownMonths(month, compare);
  // Start the lists on the month before the oldest shown one.
  const suggestion = shiftMonth(shown.at(-1)!, -1);
  const name = (m: string) => format.dateTime(monthDate(m), { month: "long", year: "numeric", timeZone: "UTC" });
  const monthNames = Array.from({ length: 12 }, (_, i) => format.dateTime(new Date(Date.UTC(2000, i, 1)), { month: "long", timeZone: "UTC" }));

  return (
    // A new choice starts the picker afresh, so its lists start on the new suggestion.
    <ComparePicker
      key={`${month}|${compare.join(",")}`}
      account={accountId}
      month={month}
      compare={compare}
      current={current}
      suggestion={suggestion < "1970-01" ? "1970-01" : suggestion}
      chips={compare.map((m) => ({ month: m, name: name(m), removeLabel: t("compareRemove", { month: name(m) }) }))}
      monthNames={monthNames}
      years={yearChoices(current, suggestion)}
      labels={{ group: t("compareGroup"), add: t("compareAdd"), confirm: t("compareConfirm"), cancel: t("compareCancel"), month: t("month"), year: t("year") }}
    />
  );
}

/**
 * The main month and the compared ones, newest first: the figure tiles and the money flow per month,
 * the categories (one bar per month when comparing) and the 12 months up to the main month.
 * accountId null: all of the caller's own private accounts together.
 */
async function MonthSeries({ caller, accountId, month, compare }: { caller: Caller; accountId: string | null; month: string; compare: string[] }) {
  const target = accountId ?? ({ ownPrivate: true } as const);
  const months = shownMonths(month, compare);
  const comparing = months.length > 1;
  const [perMonth, { names }] = await Promise.all([
    Promise.all(
      months.map(async (m) => {
        const [statistics, trends, flow] = await Promise.all([
          insights.statistics(caller, target, MONTHS, m),
          insights.categoryTrends(caller, target, m),
          insights.moneyFlow(caller, target, m),
        ]);
        return { month: m, statistics, trends, flow };
      }),
    ),
    categories.catalog(caller),
  ]);
  const main = perMonth.find((p) => p.month === month)!;
  if (!main.statistics.ok) return null;
  const { rows, scaleCents: scale } = main.statistics;
  const t = await getTranslations("app.statistics");
  const format = await getFormatter();
  const shortName = (m: string) => format.dateTime(monthDate(m), { month: "short", year: "numeric", timeZone: "UTC" });
  const longName = (m: string) => format.dateTime(monthDate(m), { month: "long", year: "numeric", timeZone: "UTC" });
  const accountParam = accountId ?? ALL_MINE;
  // A compared month clicked in the history becomes the main month, and the main month takes its place.
  const historyHref = (m: string) =>
    statisticsHref({ account: accountParam, month: m, compare: compare.map((c) => (c === m ? month : c)) });

  return (
    <>
      {perMonth.map(({ month: m, statistics }) =>
        statistics.ok ? (
          <CurrentMonth
            key={m}
            title={comparing ? longName(m) : undefined}
            row={statistics.rows[0]}
            account={accountParam}
            comparison={statistics.comparison}
            previousMonth={statistics.rows[1]?.month}
            running={statistics.running}
          />
        ) : null,
      )}
      {perMonth.map(({ month: m, flow }) => flow.ok && <MoneyFlow key={m} flow={flow} account={accountParam} categoryNames={names} withYear={comparing} />)}
      {comparing ? (
        <CategoryCompare
          months={perMonth.flatMap(({ month: m, trends }) => (trends.ok ? [{ month: m, groups: trends.groups.map((g) => ({ group: g.group, cents: g.trend.at(-1) ?? 0 })) }] : []))}
          main={month}
          account={accountParam}
          categoryNames={names}
        />
      ) : (
        main.trends.ok && <CategoryTrends trends={main.trends} account={accountParam} categoryNames={names} />
      )}
      <Section title={t("history", { from: shortName(rows.at(-1)!.month), to: shortName(rows[0].month) })}>
        <ol className="flex flex-col divide-y divide-base-300">
          {rows.map((row) => (
            <MonthRow key={row.month} row={row} scale={scale} href={historyHref(row.month)} highlighted={comparing && months.includes(row.month)} />
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
  title,
  row,
  account,
  comparison,
  previousMonth,
  running,
}: {
  /** A visible heading (the month's name) when several months are compared. */
  title?: string;
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
      {title ? <h2 className="text-lg font-semibold">{title}</h2> : <h2 className="sr-only">{t("overview")}</h2>}
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

async function MonthRow({ row, scale, href, highlighted = false }: { row: StatisticsRow; scale: number; href: string; highlighted?: boolean }) {
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
    // A compared month is marked with a bar at its left edge.
    <li
      aria-current={highlighted ? "true" : undefined}
      className={`flex flex-col gap-2 py-4 first:pt-1 ${highlighted ? "-mx-3 rounded-box border-l-4 border-primary bg-base-200/60 px-3" : ""} ${row.incomeCents === 0 && spent === 0 ? "opacity-45" : ""}`}
    >
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
