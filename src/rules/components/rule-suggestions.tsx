"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type ComponentProps } from "react";
import type { RuleAccount, RuleSuggestion } from "../types";
import { RuleForm } from "./rule-form";

type Props = {
  suggestions: RuleSuggestion[];
  /** The accounts the user may see, with their visibility (passed by the app). */
  accounts: RuleAccount[];
  /** The page's category catalog, for the rule form. */
  categories?: ComponentProps<typeof RuleForm>["categories"];
  /** Endpoint for hiding a suggestion. Default: /api/rules/suggestions/dismiss */
  dismissAction?: string;
};

const keyOf = (s: RuleSuggestion) => `${s.field}:${s.pattern}`;

/**
 * Words that keep coming back in bookings no rule covers yet. "Regel anlegen" opens the rule form
 * prefilled below the suggestion (one at a time); the member picks the category.
 */
export function RuleSuggestions({ suggestions, accounts, categories, dismissAction = "/api/rules/suggestions/dismiss" }: Props) {
  const t = useTranslations("rules.suggestions");
  const [open, setOpen] = useState<string | null>(null);

  if (suggestions.length === 0) return null;

  return (
    <section aria-labelledby="rule-suggestions-title" className="card border border-base-300 bg-base-100">
      <div className="card-body gap-3 p-4">
        <div>
          <h2 id="rule-suggestions-title" className="font-semibold">{t("title")}</h2>
          <p className="text-sm text-base-content/70">{t("intro")}</p>
        </div>
        <ul className="flex flex-col">
          {suggestions.map((suggestion) => {
            const key = keyOf(suggestion);
            const expanded = open === key;
            return (
              <li key={key} className="border-b border-base-300/70 py-3 last:border-b-0">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="break-words">
                      {t(suggestion.field === "counterparty" ? "counterparty" : "reference", { text: suggestion.pattern, count: suggestion.count })}
                    </p>
                    {suggestion.field === "reference" && suggestion.example && (
                      <p className="text-sm break-words text-base-content/60">{t("example", { text: suggestion.example })}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 justify-end gap-1">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : key)}
                    >
                      {expanded ? t("close") : t("create")}
                    </button>
                    <DismissButton suggestion={suggestion} action={dismissAction} />
                  </div>
                </div>
                {expanded && (
                  <div className="mt-3 rounded-box bg-base-200/60 p-3">
                    <RuleForm
                      accounts={accounts}
                      categories={categories}
                      initial={{
                        scope: { type: "account", accountId: suggestion.accountId },
                        counterparty: suggestion.field === "counterparty" ? suggestion.pattern : null,
                        reference: suggestion.field === "reference" ? suggestion.pattern : null,
                        kind: suggestion.kind,
                      }}
                      onSaved={() => setOpen(null)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function DismissButton({ suggestion, action }: { suggestion: RuleSuggestion; action: string }) {
  const t = useTranslations("rules.suggestions");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function dismiss() {
    setPending(true);
    setFailed(false);
    // The pattern goes in the body, never in the URL.
    const response = await fetch(action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ field: suggestion.field, pattern: suggestion.pattern }),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) return setFailed(true);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end">
      <button type="button" className="btn btn-ghost btn-sm font-normal" onClick={dismiss} disabled={pending}>
        {t("dismiss")}
      </button>
      {failed && <span className="text-error text-xs">{t("dismissFailed")}</span>}
    </div>
  );
}
