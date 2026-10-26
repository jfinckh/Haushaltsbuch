"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callApi } from "@/shared/api-client";
import type { RuleAccount } from "../types";

type Props = {
  /** The accounts the user may see (passed by the app). */
  accounts: RuleAccount[];
  /** Endpoint. Default: /api/rules/apply */
  action?: string;
};

/** Applies the rules to an account's bookings without category and says how many it sorted. */
export function ApplyRulesForm({ accounts, action = "/api/rules/apply" }: Props) {
  const t = useTranslations("rules.apply");
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailed(false);
    setResult(null);
    const result = await callApi<{ applied: number }>(action, { json: { accountId } });
    setPending(false);
    if (!result.ok) return setFailed(true);
    setResult(result.data.applied);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="text-base-content/70 text-sm">{t("text")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <fieldset className="fieldset min-w-48 flex-1">
          <label className="fieldset-legend" htmlFor="apply-account">{t("account")}</label>
          <select id="apply-account" className="select w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={pending || !accountId}>
          {pending && <span className="loading loading-spinner loading-sm" />}
          {t("submit")}
        </button>
      </div>
      {result !== null && (
        <p role="status" className="text-success">
          {t("result", { count: result })}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-error">
          {t("failed")}
        </p>
      )}
    </form>
  );
}
