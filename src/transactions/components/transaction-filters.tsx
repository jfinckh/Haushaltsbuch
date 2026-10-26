"use client";

import { useFormatter, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { CategoryChoice } from "../categories";
import { TRANSACTION_KINDS, type TransactionKind } from "../kinds";
import { isMonth, monthOf, monthRange, shiftMonth, today } from "../months";
import { CategorySelect } from "./category-select";
import { useCategoryName } from "./use-category-name";

/** The filters as they come from the URL query; invalid values are ignored. */
export type TransactionFilterValues = {
  /** YYYY-MM; default: the current month. */
  month?: string;
  /** YYYY; only with `periods`. */
  year?: string;
  /** YYYY-MM-DD range; only with `periods`; either side may be empty. */
  from?: string;
  to?: string;
  kind?: string;
  category?: string;
  q?: string;
};

type Props = {
  values: TransactionFilterValues;
  /** Shows the period tabs (month, year, range) and the chips of the active filters. Default: only the month switcher. */
  periods?: boolean;
  /** Query params kept in every URL the filters build (e.g. the chosen account). */
  params?: Record<string, string>;
  /** The categories to filter by (the page's catalog for the account). Default: the standard ones. */
  categoryGroups?: CategoryChoice[];
  /** Names of own categories (the page's catalog). */
  categoryNames?: Record<string, string>;
};

/** Exactly one of these is active. A range may have an empty side. */
type Period = { month: string } | { year: string } | { from: string; to: string };
type Filters = { kind?: TransactionKind; category?: string; q?: string };
type Tab = "month" | "year" | "range";

const isKind = (value: string | undefined): value is TransactionKind =>
  (TRANSACTION_KINDS as readonly string[]).includes(value ?? "");
const isYear = (value: string | undefined): value is string => /^\d{4}$/.test(value ?? "") && Number(value) >= 1970;
const isDay = (value: string | undefined): value is string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // Out-of-range parts (month 13) give an invalid date; overflowing days (Feb 31) do not round-trip.
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value ?? "");
};

function periodOf(raw: TransactionFilterValues, periods: boolean): Period {
  if (periods && (isDay(raw.from) || isDay(raw.to))) return { from: isDay(raw.from) ? raw.from : "", to: isDay(raw.to) ? raw.to : "" };
  if (periods && isYear(raw.year)) return { year: raw.year };
  return { month: raw.month && isMonth(raw.month) ? raw.month : monthOf(today()) };
}

/** Period switcher, type and category filters and search; they live in the page's URL query. */
export function TransactionFilters({ values: raw, periods = false, params, categoryGroups, categoryNames }: Props) {
  const period = periodOf(raw, periods);
  const tab: Tab = "from" in period ? "range" : "year" in period ? "year" : "month";
  const values: Filters = {
    kind: isKind(raw.kind) ? raw.kind : undefined,
    category: raw.category || undefined,
    q: raw.q || undefined,
  };
  const t = useTranslations("transactions.filters");
  const tKinds = useTranslations("transactions.kinds");
  const categoryName = useCategoryName(categoryNames);
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const [kind, setKind] = useState<string>(values.kind ?? "");
  const [category, setCategory] = useState(values.category ?? "");

  function go(nextPeriod: Period, next: Filters) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) if (value) query.set(key, value);
    for (const [key, value] of Object.entries(nextPeriod)) if (value) query.set(key, value);
    if (next.kind) query.set("kind", next.kind);
    if (next.category) query.set("category", next.category);
    if (next.q) query.set("q", next.q);
    router.push(`${pathname}?${query}`);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const q = String(data.get("q") ?? "").trim();
    let nextPeriod = period;
    if ("from" in period) {
      const from = String(data.get("from") ?? "");
      const to = String(data.get("to") ?? "");
      nextPeriod = { from: isDay(from) ? from : "", to: isDay(to) ? to : "" };
    }
    go(nextPeriod, { kind: isKind(kind) ? kind : undefined, category: category || undefined, q: q || undefined });
  }

  function switchTab(next: Tab) {
    if (next === tab) return;
    const now = today();
    go(next === "month" ? { month: monthOf(now) } : next === "year" ? { year: now.slice(0, 4) } : monthRange(monthOf(now)), values);
  }

  const monthLabel = (month: string) => {
    const [y, m] = month.split("-").map(Number);
    return format.dateTime(new Date(Date.UTC(y, m - 1, 1)), { timeZone: "UTC", month: "long", year: "numeric" });
  };
  const shiftYear = (year: string, delta: number) => String(Math.min(Math.max(Number(year) + delta, 1970), 9999));

  const chips: { param: keyof Filters; label: string }[] = [];
  if (periods) {
    if (values.kind) chips.push({ param: "kind", label: tKinds(values.kind) });
    if (values.category) chips.push({ param: "category", label: values.category === "none" ? t("uncategorized") : categoryName(values.category) });
    if (values.q) chips.push({ param: "q", label: values.q });
  }

  const arrow = "btn btn-sm join-item";
  const label = "join-item flex h-8 min-w-36 items-center justify-center border-y border-base-300 px-3 text-sm font-medium";

  return (
    <div className="@container min-w-0">
      <div className="flex flex-col gap-2 @3xl:flex-row @3xl:items-center">
        {periods && (
          <div role="tablist" className="tabs tabs-box tabs-sm shrink-0 self-start @3xl:self-auto">
            {(["month", "year", "range"] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "tab-active" : ""}`} onClick={() => switchTab(id)}>
                {t(id === "month" ? "periodMonth" : id === "year" ? "periodYear" : "periodRange")}
              </button>
            ))}
          </div>
        )}
        {"month" in period && (
          <div className="join shrink-0 self-start @3xl:self-auto">
            <button type="button" className={arrow} aria-label={t("previousMonth")} onClick={() => go({ month: shiftMonth(period.month, -1) }, values)}>
              ‹
            </button>
            <span className={label}>{monthLabel(period.month)}</span>
            <button type="button" className={arrow} aria-label={t("nextMonth")} onClick={() => go({ month: shiftMonth(period.month, 1) }, values)}>
              ›
            </button>
          </div>
        )}
        {"year" in period && (
          <div className="join shrink-0 self-start @3xl:self-auto">
            <button type="button" className={arrow} aria-label={t("previousYear")} disabled={Number(period.year) <= 1970} onClick={() => go({ year: shiftYear(period.year, -1) }, values)}>
              ‹
            </button>
            <span className={label}>{period.year}</span>
            <button type="button" className={arrow} aria-label={t("nextYear")} disabled={Number(period.year) >= 9999} onClick={() => go({ year: shiftYear(period.year, 1) }, values)}>
              ›
            </button>
          </div>
        )}
        <form onSubmit={onSubmit} className="flex min-w-0 flex-1 flex-col gap-2 @xl:flex-row @xl:flex-wrap @3xl:flex-nowrap">
          {"from" in period && (
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="filter-from">{t("from")}</label>
              <input id="filter-from" key={period.from} name="from" type="date" defaultValue={period.from} className="input input-sm" />
              <label className="sr-only" htmlFor="filter-to">{t("to")}</label>
              <input id="filter-to" key={period.to} name="to" type="date" defaultValue={period.to} className="input input-sm" />
            </div>
          )}
          <label className="sr-only" htmlFor="filter-kind">{t("kind")}</label>
          <select id="filter-kind" className="select select-sm w-full @xl:w-auto @xl:min-w-32 @xl:flex-1" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t("allKinds")}</option>
            {TRANSACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {tKinds(k)}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="filter-category">{t("category")}</label>
          <div className="min-w-0 @xl:min-w-40 @xl:flex-1 [&_select]:h-8 [&_select]:min-h-8 [&_select]:text-sm">
            <CategorySelect
              id="filter-category"
              kinds={kind === "expense" || kind === "income" ? [kind] : ["expense", "income"]}
              value={category}
              onChange={setCategory}
              emptyLabel={t("allCategories")}
              noneLabel={periods ? t("uncategorized") : undefined}
              groups={categoryGroups}
              names={categoryNames}
            />
          </div>
          <div className="join w-full @xl:basis-full @3xl:w-auto @3xl:flex-[1.4] @3xl:basis-auto">
            <label className="sr-only" htmlFor="filter-q">{t("search")}</label>
            <input key={values.q ?? ""} id="filter-q" name="q" type="search" defaultValue={values.q ?? ""} placeholder={t("searchPlaceholder")} className="input input-sm join-item w-full" maxLength={100} />
            <button type="submit" className="btn btn-sm join-item">
              {t("apply")}
            </button>
          </div>
        </form>
      </div>
      {chips.length > 0 && (
        <ul aria-label={t("active")} className="mt-2 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li key={chip.param}>
              <button
                type="button"
                className="badge badge-neutral gap-1"
                aria-label={t("remove", { label: chip.label })}
                onClick={() => {
                  const next = { ...values, [chip.param]: undefined };
                  if (chip.param === "kind") setKind("");
                  if (chip.param === "category") setCategory("");
                  go(period, next);
                }}
              >
                {chip.label}
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
