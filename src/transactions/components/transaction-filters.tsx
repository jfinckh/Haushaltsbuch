"use client";

import { useFormatter, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { CategoryChoice } from "../categories";
import { TRANSACTION_KINDS, type TransactionKind } from "../kinds";
import { isMonth, monthOf, shiftMonth, today } from "../months";
import { CategorySelect } from "./category-select";

/** The filters as they come from the URL query; invalid values are ignored. */
export type TransactionFilterValues = {
  /** YYYY-MM; default: the current month. */
  month?: string;
  kind?: string;
  category?: string;
  q?: string;
};

type Props = {
  values: TransactionFilterValues;
  /** The categories to filter by (the page's catalog for the account). Default: the standard ones. */
  categoryGroups?: CategoryChoice[];
  /** Names of own categories (the page's catalog). */
  categoryNames?: Record<string, string>;
};

const isKind = (value: string | undefined): value is TransactionKind =>
  (TRANSACTION_KINDS as readonly string[]).includes(value ?? "");

/** Month switcher, type and category filters and search; they live in the page's URL query. */
export function TransactionFilters({ values: raw, categoryGroups, categoryNames }: Props) {
  const values = {
    month: raw.month && isMonth(raw.month) ? raw.month : monthOf(today()),
    kind: isKind(raw.kind) ? raw.kind : undefined,
    category: raw.category || undefined,
    q: raw.q || undefined,
  };
  const t = useTranslations("transactions.filters");
  const tKinds = useTranslations("transactions.kinds");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const [kind, setKind] = useState<string>(values.kind ?? "");
  const [category, setCategory] = useState(values.category ?? "");

  function go(next: typeof values) {
    const params = new URLSearchParams();
    params.set("month", next.month);
    if (next.kind) params.set("kind", next.kind);
    if (next.category) params.set("category", next.category);
    if (next.q) params.set("q", next.q);
    router.push(`${pathname}?${params}`);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    go({ month: values.month, kind: isKind(kind) ? kind : undefined, category: category || undefined, q: q || undefined });
  }

  const [year, month] = values.month.split("-").map(Number);
  const monthLabel = format.dateTime(new Date(Date.UTC(year, month - 1, 1)), { timeZone: "UTC", month: "long", year: "numeric" });

  return (
    <div className="@container min-w-0">
      <div className="flex flex-col gap-2 @3xl:flex-row @3xl:items-center">
        <div className="join shrink-0 self-start @3xl:self-auto">
          <button type="button" className="btn btn-sm join-item" aria-label={t("previousMonth")} onClick={() => go({ ...values, month: shiftMonth(values.month, -1) })}>
            ‹
          </button>
          <span className="join-item flex h-8 min-w-36 items-center justify-center border-y border-base-300 px-3 text-sm font-medium">{monthLabel}</span>
          <button type="button" className="btn btn-sm join-item" aria-label={t("nextMonth")} onClick={() => go({ ...values, month: shiftMonth(values.month, 1) })}>
            ›
          </button>
        </div>
        <form onSubmit={onSubmit} className="flex min-w-0 flex-1 flex-col gap-2 @xl:flex-row @xl:flex-wrap @3xl:flex-nowrap">
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
              groups={categoryGroups}
              names={categoryNames}
            />
          </div>
          <div className="join w-full @xl:basis-full @3xl:w-auto @3xl:flex-[1.4] @3xl:basis-auto">
            <label className="sr-only" htmlFor="filter-q">{t("search")}</label>
            <input id="filter-q" name="q" type="search" defaultValue={values.q ?? ""} placeholder={t("searchPlaceholder")} className="input input-sm join-item w-full" maxLength={100} />
            <button type="submit" className="btn btn-sm join-item">
              {t("apply")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
