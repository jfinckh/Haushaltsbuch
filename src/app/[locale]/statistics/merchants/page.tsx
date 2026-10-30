import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountSwitcher } from "@/app/_lib/account-switcher";
import { accounts } from "@/app/_lib/accounts";
import { AppShell, PageHeader, Section } from "@/app/_lib/app-shell";
import { bookingsHref } from "@/app/_lib/bookings-href";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { insights } from "@/app/_lib/insights";
import { ALL_MINE, selectAccount } from "@/insights";
import type { MerchantRanking } from "@/insights/server";
import { formatEuro } from "@/shared/money";
import type { Caller } from "@/shared/rls";
import { chosenMonth, currentMonth, shiftMonth } from "../month-switcher";
import { ViewTabs } from "../view-tabs";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The earliest year and month the switcher links to (insights accepts nothing earlier). */
const FIRST_YEAR = 1970;
const FIRST_MONTH = "1970-01";

/** How many merchants the list shows before "show all". */
const TOP = 20;

/** The bookings search accepts at most this many characters; a merchant's key is cut to it. */
const MAX_SEARCH = 100;

type Period = { kind: "month"; month: string } | { kind: "year"; year: number };

export default function MerchantsPage(props: Props) {
  return (
    <AppShell>
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Merchants {...props} />
      </Suspense>
    </AppShell>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The period named in the address; anything missing, malformed or in the future falls back to the current month or year. */
function chosenPeriod(query: Record<string, string | string[] | undefined>): Period {
  if (first(query.period) === "year") {
    const currentYear = Number(currentMonth().slice(0, 4));
    const asked = Number(first(query.year));
    return { kind: "year", year: Number.isInteger(asked) && asked >= FIRST_YEAR && asked <= currentYear ? asked : currentYear };
  }
  return { kind: "month", month: chosenMonth(first(query.month)) };
}

/** The address of this view. */
function merchantsHref(account: string, period: Period, all = false): string {
  const params = new URLSearchParams({ account, period: period.kind });
  if (period.kind === "month") params.set("month", period.month);
  else params.set("year", String(period.year));
  if (all) params.set("all", "1");
  return `/statistics/merchants?${params}`;
}

/** The period before and after, or null at the ends (1970, and the current month or year). */
function neighbours(period: Period): { previous: Period | null; next: Period | null } {
  if (period.kind === "month") {
    const current = currentMonth();
    return {
      previous: period.month > FIRST_MONTH ? { kind: "month", month: shiftMonth(period.month, -1) } : null,
      next: period.month < current ? { kind: "month", month: shiftMonth(period.month, 1) } : null,
    };
  }
  const currentYear = Number(currentMonth().slice(0, 4));
  return {
    previous: period.year > FIRST_YEAR ? { kind: "year", year: period.year - 1 } : null,
    next: period.year < currentYear ? { kind: "year", year: period.year + 1 } : null,
  };
}

const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

/**
 * Spending per merchant in a month (?period=month&month=YYYY-MM, the default) or a year
 * (?period=year&year=YYYY) of one visible account (?account=<id>) or of all own private accounts
 * (?account=all). The top merchants first; ?all=1 shows every one.
 */
async function Merchants({ searchParams }: Props) {
  const { caller } = await requireCaller("/sign-in");
  if (!(await households.getHousehold(caller))) redirect("/household/new");
  const query = await searchParams;
  // The same choice as the dashboard: only accounts the caller may see.
  const visibleAccounts = await accounts.listAccounts(caller);
  const selected = selectAccount(visibleAccounts, first(query.account));
  const selectedId = selected === ALL_MINE ? ALL_MINE : (selected?.id ?? "");
  const period = chosenPeriod(query);
  const all = first(query.all) === "1";
  const t = await getTranslations("app.statistics");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} />
      {selected ? (
        <>
          <ViewTabs view="merchants" accountId={selectedId} />
          <AccountSwitcher
            accounts={visibleAccounts}
            selectedId={selectedId}
            path="/statistics/merchants"
            params={period.kind === "month" ? { period: "month", month: period.month } : { period: "year", year: String(period.year) }}
          />
          <PeriodSwitcher account={selectedId} period={period} />
          <Ranking caller={caller} account={selectedId} period={period} all={all} />
        </>
      ) : (
        <p className="opacity-70">{t("noAccounts")}</p>
      )}
    </div>
  );
}

/** Month or year, and arrows to the period before and after. */
async function PeriodSwitcher({ account, period }: { account: string; period: Period }) {
  const t = await getTranslations("app.statistics.merchants");
  const format = await getFormatter();
  const label = (p: Period) => (p.kind === "month" ? format.dateTime(monthDate(p.month), { month: "long", year: "numeric", timeZone: "UTC" }) : String(p.year));
  const { previous, next } = neighbours(period);
  const month: Period = { kind: "month", month: period.kind === "month" ? period.month : currentMonth() };
  const year: Period = { kind: "year", year: period.kind === "year" ? period.year : Number(period.month.slice(0, 4)) };

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t("periodKind")} className="join self-start">
        {[
          { p: month, text: t("month") },
          { p: year, text: t("year") },
        ].map(({ p, text }) => (
          <Link
            key={p.kind}
            href={merchantsHref(account, p)}
            aria-current={p.kind === period.kind ? "page" : undefined}
            className={`btn join-item btn-sm ${p.kind === period.kind ? "btn-primary" : ""}`}
          >
            {text}
          </Link>
        ))}
      </div>
      <nav aria-label={t("periodSwitcher")} className="flex items-center justify-between">
        {previous ? (
          <Link href={merchantsHref(account, previous)} className="btn btn-ghost btn-sm" aria-label={t("previous")}>
            ‹ {label(previous)}
          </Link>
        ) : (
          <span />
        )}
        <h2 className="text-lg font-semibold tabular-nums">{label(period)}</h2>
        {next ? (
          <Link href={merchantsHref(account, next)} className="btn btn-ghost btn-sm" aria-label={t("next")}>
            {label(next)} ›
          </Link>
        ) : (
          <span className="w-16" />
        )}
      </nav>
    </div>
  );
}

/** The merchants by spending, each with its share, purchases and the change from the period before. */
async function Ranking({ caller, account, period, all }: { caller: Caller; account: string; period: Period; all: boolean }) {
  const target = account === ALL_MINE ? ({ ownPrivate: true } as const) : account;
  const ranking = await insights.merchantRanking(caller, target, period.kind === "month" ? { month: period.month } : { year: period.year });
  if (!ranking.ok) return null;
  const t = await getTranslations("app.statistics.merchants");
  const format = await getFormatter();
  const { previous } = neighbours(period);
  const than = !previous
    ? ""
    : previous.kind === "month"
      ? t("thanMonth", { month: format.dateTime(monthDate(previous.month), { month: "long", timeZone: "UTC" }) })
      : t("thanYear", { year: previous.year });
  const title = period.kind === "month" ? t("titleMonth", { month: format.dateTime(monthDate(period.month), { month: "long", year: "numeric", timeZone: "UTC" }) }) : t("titleYear", { year: period.year });
  const origin = merchantsHref(account, period, all);
  const shown = all ? ranking.merchants : ranking.merchants.slice(0, TOP);
  const largest = Math.max(1, ...ranking.merchants.map((m) => m.spentCents));

  return (
    <Section title={title}>
      <p className="text-xs text-base-content/60">{t("hint")}</p>
      {ranking.merchants.length === 0 ? (
        <p className="opacity-70">{t("empty")}</p>
      ) : (
        <>
          <ol className="flex flex-col divide-y divide-base-300">
            {shown.map((merchant, i) => (
              <MerchantItem
                key={merchant.key ?? ""}
                rank={merchant.key === null ? null : i + 1}
                merchant={merchant}
                totalCents={ranking.totalCents}
                largestCents={largest}
                than={ranking.hasPrevious ? than : null}
                href={
                  merchant.key === null
                    ? null
                    : bookingsHref({
                        account,
                        ...(period.kind === "month" ? { month: period.month } : { year: period.year }),
                        kind: "expense",
                        q: merchant.key.slice(0, MAX_SEARCH),
                        origin,
                      })
                }
              />
            ))}
          </ol>
          <p className="flex flex-wrap items-center justify-between gap-2 text-sm text-base-content/70">
            <span>{t("total", { amount: formatEuro(ranking.totalCents), count: ranking.merchants.filter((m) => m.key !== null).length })}</span>
            {ranking.merchants.length > TOP && (
              <Link href={merchantsHref(account, period, !all)} className="btn btn-sm">
                {all ? t("showTop", { count: TOP }) : t("showAll", { count: ranking.merchants.length })}
              </Link>
            )}
          </p>
        </>
      )}
    </Section>
  );
}

type Row = MerchantRanking["merchants"][number];

async function MerchantItem({
  rank,
  merchant,
  totalCents,
  largestCents,
  than,
  href,
}: {
  /** Null for the bookings without a name. */
  rank: number | null;
  merchant: Row;
  totalCents: number;
  /** The largest merchant's spending: a full bar. */
  largestCents: number;
  /** How the period before is named ("im September"), or null when there is nothing to compare with. */
  than: string | null;
  href: string | null;
}) {
  const t = await getTranslations("app.statistics.merchants");
  const format = await getFormatter();
  const name = merchant.name ?? t("noName");
  const share = format.number(merchant.spentCents / Math.max(1, totalCents), { style: "percent", maximumFractionDigits: 1 });
  const width = Math.min(100, (merchant.spentCents / largestCents) * 100);
  const difference = merchant.spentCents - merchant.previousCents;
  const change =
    than === null || merchant.key === null
      ? null
      : merchant.previousCents === 0
        ? { text: t("new", { than }), tone: "text-base-content/60" }
        : difference === 0
          ? { text: t("same", { than }), tone: "text-base-content/60" }
          : {
              text: t(difference > 0 ? "more" : "less", { amount: formatEuro(Math.abs(difference)), than }),
              tone: difference > 0 ? "text-error" : "text-success",
              arrow: difference > 0 ? "↑" : "↓",
            };

  return (
    <li className={`relative flex flex-col gap-1.5 py-3 ${href ? "transition-colors has-[a:hover]:bg-base-200/60" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="w-6 shrink-0 text-right text-xs tabular-nums text-base-content/50">{rank ?? ""}</span>
          {href ? (
            // The link stretches over the whole row.
            <Link href={href} className="truncate font-medium before:absolute before:inset-0">
              {name}
            </Link>
          ) : (
            <span className="truncate font-medium italic text-base-content/70">{name}</span>
          )}
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{formatEuro(merchant.spentCents)}</span>
      </div>
      <div className="ml-8 h-2 overflow-hidden rounded-full bg-base-200" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
      <div className="ml-8 flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-xs">
        <span className="text-base-content/60">
          {[
            t("share", { share }),
            t("purchases", { count: merchant.purchases }),
            ...(merchant.purchases > 1 ? [t("average", { amount: formatEuro(merchant.averageCents) })] : []),
          ].join(" · ")}
        </span>
        {change && (
          <span className={`flex gap-1 ${change.tone}`}>
            {"arrow" in change && <span aria-hidden>{change.arrow}</span>}
            <span>{change.text}</span>
          </span>
        )}
      </div>
    </li>
  );
}
