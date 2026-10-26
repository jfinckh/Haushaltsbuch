"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "@/shared/api-client";
import type { RuleAccount, RuleView } from "../types";
import { useRuleTexts } from "./use-rule-texts";

type Props = {
  rules: RuleView[];
  /** The accounts the user may see, for the names (passed by the app). */
  accounts: RuleAccount[];
  /** Names of own categories (the page's catalog). */
  categoryNames?: Record<string, string>;
  /** Endpoint for rules. Default: /api/rules */
  action?: string;
  /** Base path of the edit pages. Default: /rules */
  rulesHref?: string;
};

/** The rules, grouped by where they apply, each with its condition and result. */
export function RuleList({ rules, accounts, categoryNames, action = "/api/rules", rulesHref = "/rules" }: Props) {
  const t = useTranslations("rules.list");
  const texts = useRuleTexts(accounts, categoryNames);

  if (rules.length === 0) return <p className="text-base-content/70">{t("empty")}</p>;

  const groups = new Map<string, RuleView[]>();
  for (const rule of rules) {
    const label = texts.scope(rule.scope);
    groups.set(label, [...(groups.get(label) ?? []), rule]);
  }

  return (
    <div className="flex flex-col gap-4">
      {[...groups].map(([label, group]) => (
        <details key={label} open className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-base-300 px-1 pb-1 select-none [&::-webkit-details-marker]:hidden">
            <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="size-3.5 text-base-content/55 transition-transform group-open:rotate-90">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.17 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
            </svg>
            <h2 className="flex-1 text-xs font-medium tracking-wide text-base-content/55 uppercase">{label}</h2>
            <span className="badge badge-ghost badge-sm">{group.length}</span>
          </summary>
          <ul className="flex flex-col">
            {group.map((rule) => (
              <li key={rule.id} className="flex flex-col gap-1 border-b border-base-300/70 px-1 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="break-words">{texts.condition(rule)}</p>
                  <p className="text-sm text-base-content/60">→ {texts.result(rule)}</p>
                </div>
                {/* Below the text on a phone, so long conditions and category names keep the full width. */}
                <div className="flex shrink-0 justify-end gap-1">
                  <Link href={`${rulesHref}/${rule.id}`} className="btn btn-ghost btn-sm font-normal">
                    {t("edit")}
                  </Link>
                  <DeleteRuleButton id={rule.id} action={action} />
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

function DeleteRuleButton({ id, action }: { id: string; action: string }) {
  const t = useTranslations("rules.list");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
    setPending(true);
    setFailed(false);
    const result = await callApi(`${action}/${id}`, { method: "DELETE" });
    setPending(false);
    if (!result.ok && result.status !== 404) return setFailed(true);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        className={`btn btn-sm font-normal ${confirming ? "btn-error" : "btn-ghost text-error"}`}
        onClick={() => (confirming ? remove() : setConfirming(true))}
        onBlur={() => setConfirming(false)}
        disabled={pending}
      >
        {confirming ? t("confirmDelete") : t("delete")}
      </button>
      {failed && <span className="text-error text-xs">{t("deleteFailed")}</span>}
    </div>
  );
}
