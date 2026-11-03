"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type ComponentProps } from "react";
import { callApi } from "@/shared/api-client";
import { formatCents } from "@/shared/money";
import type { RecurringSuggestion } from "../contract";
import { TemplateForm } from "./template-form";

type Props = {
  suggestions: RecurringSuggestion[];
  /** The accounts the user may use (passed by the app). */
  accounts: ComponentProps<typeof TemplateForm>["accounts"];
  /** The page's category catalog, for the template form. */
  categories?: ComponentProps<typeof TemplateForm>["categories"];
  /** Endpoint to hide a suggestion. Default: /api/recurring/suggestions/dismiss */
  dismissAction?: string;
};

/** Bookings that repeat, each with "Als Vorlage übernehmen" (inline template form) and "Ausblenden". */
export function RecurringSuggestions({ suggestions, accounts, categories, dismissAction = "/api/recurring/suggestions/dismiss" }: Props) {
  const t = useTranslations("recurring");
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  if (suggestions.length === 0) return null;

  const keyOf = (s: RecurringSuggestion) => `${s.accountId}:${s.kind}:${s.counterparty}`;
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? t("list.unknownAccount");
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { timeZone: "UTC", dateStyle: "medium" });

  /**
   * After saving a template from a suggestion: close the form and hide the suggestion, so it cannot
   * be adopted twice when the template got another name or account.
   */
  async function adopted(suggestion: RecurringSuggestion) {
    setOpen(null);
    await dismiss(suggestion);
  }

  async function dismiss(suggestion: RecurringSuggestion) {
    const key = keyOf(suggestion);
    setPending(key);
    setFailed(null);
    const result = await callApi(dismissAction, { json: { accountId: suggestion.accountId, counterparty: suggestion.counterparty } });
    setPending(null);
    if (!result.ok) return setFailed(key);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2 rounded-box bg-base-200 p-4">
      <h2 className="font-medium">{t("suggestions.title")}</h2>
      <p className="text-sm text-base-content/70">{t("suggestions.intro")}</p>
      <ul className="flex flex-col">
        {suggestions.map((suggestion) => {
          const key = keyOf(suggestion);
          return (
            <li key={key} className="flex flex-col gap-2 border-b border-base-300/70 py-3 last:border-b-0">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="break-words font-medium">{suggestion.counterparty}</span>
                    <span className="tabular-nums">{formatCents(suggestion.amountCents)} €</span>
                  </p>
                  <p className="text-sm text-base-content/60">
                    {[
                      accountName(suggestion.accountId),
                      t("list.everyMonths", { months: suggestion.intervalMonths, day: Number(suggestion.nextDueDate.slice(8, 10)) }),
                      t("suggestions.seen", { count: suggestion.count, date: date(suggestion.lastDate) }),
                    ].join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(open === key ? null : key)}>
                    {open === key ? t("suggestions.cancel") : t("suggestions.adopt")}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm font-normal" disabled={pending === key} onClick={() => dismiss(suggestion)}>
                    {t("suggestions.dismiss")}
                  </button>
                </div>
              </div>
              {failed === key && (
                <p role="alert" className="text-sm text-error">
                  {t("suggestions.failed")}
                </p>
              )}
              {open === key && (
                <div className="rounded-box bg-base-100 p-3">
                  <TemplateForm accounts={accounts} categories={categories} initial={suggestion} onSaved={() => adopted(suggestion)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
