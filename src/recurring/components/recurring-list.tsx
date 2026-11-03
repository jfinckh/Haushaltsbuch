"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "@/shared/api-client";
import { formatCents } from "@/shared/money";
import { useCategoryName } from "@/transactions";
import type { TemplateStatus, TemplateView } from "../contract";

type Props = {
  templates: TemplateView[];
  /** The accounts the user may see, for the names (passed by the app). */
  accounts: { id: string; name: string }[];
  /** Names of own categories (the page's catalog). */
  categoryNames?: Record<string, string>;
  /** Endpoint for templates. Default: /api/recurring */
  action?: string;
};

const BADGE: Record<TemplateStatus, string> = {
  active: "badge-success",
  paused: "badge-warning",
  ended: "badge-ghost",
  archived: "badge-ghost",
};

/** The regular bookings with their rhythm, next date and buttons to pause, resume, end or delete. */
export function RecurringList({ templates, accounts, categoryNames, action = "/api/recurring" }: Props) {
  const t = useTranslations("recurring");
  const tKinds = useTranslations("transactions.kinds");
  const categoryName = useCategoryName(categoryNames);
  const format = useFormatter();

  if (templates.length === 0) return <p className="text-base-content/70">{t("list.empty")}</p>;

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? t("list.unknownAccount");
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { timeZone: "UTC", dateStyle: "medium" });

  return (
    <ul className="flex flex-col">
      {templates.map((template) => (
        <li
          key={template.id}
          className="flex flex-col gap-2 border-b border-base-300/70 px-1 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="break-words font-medium">{template.counterparty ?? template.reference ?? tKinds(template.kind)}</span>
              <span className="tabular-nums">{formatCents(template.amountCents)} €</span>
              <span className={`badge badge-sm ${BADGE[template.status]}`}>{t(`status.${template.status}`)}</span>
            </p>
            <p className="text-sm text-base-content/60">
              {[
                accountName(template.accountId),
                template.category ? categoryName(template.category) : tKinds(template.kind),
                t("list.everyMonths", { months: template.intervalMonths, day: template.dayOfMonth }),
              ].join(" · ")}
            </p>
            {(template.status === "active" || template.status === "paused") && (
              <p className="text-sm text-base-content/60">
                {t("list.next", { date: date(template.nextDueDate) })}
                {template.endDate && `, ${t("list.endsOn", { date: date(template.endDate) })}`}
              </p>
            )}
          </div>
          <TemplateActions template={template} action={action} />
        </li>
      ))}
    </ul>
  );
}

function TemplateActions({ template, action }: { template: TemplateView; action: string }) {
  const t = useTranslations("recurring.list");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send(init: { method: "PATCH" | "DELETE"; json?: unknown }, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setPending(true);
    setFailed(false);
    const result = await callApi(`${action}/${template.id}`, init);
    setPending(false);
    if (!result.ok) return setFailed(true);
    router.refresh();
  }

  const button = "btn btn-ghost btn-sm font-normal";
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {template.status === "active" && (
          <button type="button" className={button} disabled={pending} onClick={() => send({ method: "PATCH", json: { action: "pause" } })}>
            {t("pause")}
          </button>
        )}
        {template.status === "paused" && (
          <button type="button" className={button} disabled={pending} onClick={() => send({ method: "PATCH", json: { action: "resume" } })}>
            {t("resume")}
          </button>
        )}
        {(template.status === "active" || template.status === "paused") && (
          <button
            type="button"
            className={button}
            disabled={pending}
            onClick={() => send({ method: "PATCH", json: { action: "end" } }, t("confirmEnd"))}
          >
            {t("end")}
          </button>
        )}
        <button type="button" className={`${button} text-error`} disabled={pending} onClick={() => send({ method: "DELETE" }, t("confirmDelete"))}>
          {t("delete")}
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-error text-sm">
          {t("failed")}
        </p>
      )}
    </div>
  );
}
