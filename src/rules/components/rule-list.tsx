"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
        <section key={label}>
          <h2 className="text-base-content/70 mb-1 text-sm font-semibold">{label}</h2>
          <ul className="list bg-base-100 rounded-box shadow-sm">
            {group.map((rule) => (
              <li key={rule.id} className="list-row items-center">
                <div className="list-col-grow min-w-0">
                  <p className="break-words">{texts.condition(rule)}</p>
                  <p className="text-base-content/70 text-sm">→ {texts.result(rule)}</p>
                </div>
                {/* Below the text, so long conditions and category names keep the full width on a phone. */}
                <div className="list-col-wrap flex justify-end gap-1">
                  <Link href={`${rulesHref}/${rule.id}`} className="btn btn-ghost btn-sm">
                    {t("edit")}
                  </Link>
                  <DeleteRuleButton id={rule.id} action={action} />
                </div>
              </li>
            ))}
          </ul>
        </section>
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
    const response = await fetch(`${action}/${id}`, { method: "DELETE" }).catch(() => null);
    setPending(false);
    if (!response?.ok && response?.status !== 404) return setFailed(true);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        className={`btn btn-sm ${confirming ? "btn-error" : "btn-ghost text-error"}`}
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
