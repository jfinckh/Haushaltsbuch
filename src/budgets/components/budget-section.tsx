"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type ComponentProps, type FormEvent } from "react";
import { callApi } from "@/shared/api-client";
import { formatCents, formatEuro } from "@/shared/money";
import { useTranslateKey } from "@/shared/use-translate-key";
import { CategorySelect, useCategoryName } from "@/transactions";
import type { BudgetView } from "../contract";
import { createBudgetSchema, updateBudgetSchema } from "../validation";

type Props = {
  accountId: string;
  /** The shown calendar month, YYYY-MM. */
  month: string;
  /** The account's budgets with their spending in the shown month. */
  budgets: BudgetView[];
  /** Endpoint. Default: /api/budgets */
  action?: string;
  /** Only the bars, without the forms to add, change and delete (dashboard). */
  readOnly?: boolean;
  /** The categories offered for a new budget (the page's catalog for the account). Default: the standard ones. */
  categoryGroups?: ComponentProps<typeof CategorySelect>["groups"];
  /** Names of own categories (the page's catalog). */
  categoryNames?: Record<string, string>;
};

/** Warning colour from 80 %, error colour above 100 %. Integer comparison, no floats. */
function progressClass(spentCents: number, limitCents: number): string {
  if (spentCents > limitCents) return "progress-error";
  if (spentCents * 5 >= limitCents * 4) return "progress-warning";
  return "progress-success";
}

/** The budgets of one account for a month: a progress bar per budget, and (unless read-only) forms to add, change and delete. */
export function BudgetSection({ accountId, month, budgets, action = "/api/budgets", readOnly = false, categoryGroups, categoryNames }: Props) {
  const t = useTranslations("budgets.section");
  const format = useFormatter();
  const monthName = format.dateTime(new Date(`${month}-01T00:00:00Z`), { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("title", { month: monthName })}</h2>
      {budgets.length === 0 ? (
        <p className="text-sm text-base-content/60">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {budgets.map((budget) => (
            <BudgetRow key={budget.id} budget={budget} action={action} readOnly={readOnly} categoryNames={categoryNames} />
          ))}
        </ul>
      )}
      {!readOnly && <AddBudgetForm accountId={accountId} action={action} categoryGroups={categoryGroups} categoryNames={categoryNames} />}
    </section>
  );
}

function BudgetRow({
  budget,
  action,
  readOnly,
  categoryNames,
}: {
  budget: BudgetView;
  action: string;
  readOnly: boolean;
  categoryNames?: Record<string, string>;
}) {
  const t = useTranslations("budgets.section");
  const translateKey = useTranslateKey();
  const categoryName = useCategoryName(categoryNames);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(formatCents(budget.limitCents));
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spent = Math.max(0, budget.spentCents);
  const percent = Math.round((spent * 100) / budget.limitCents);
  const name = categoryName(budget.category);

  async function send(method: "PATCH" | "DELETE", body?: unknown) {
    setPending(true);
    setError(null);
    const result = await callApi(`${action}/${budget.id}`, { method, json: body });
    setPending(false);
    if (!result.ok) {
      setError(t("failed"));
      return false;
    }
    router.refresh();
    return true;
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = updateBudgetSchema.safeParse({ limit });
    if (!parsed.success) return setError(translateKey(parsed.error.issues[0].message));
    if (await send("PATCH", { limit })) setEditing(false);
  }

  return (
    <li className="flex flex-col gap-1.5 border-b border-base-300/70 pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        <span className="shrink-0 text-sm text-base-content/70">
          {t("spentOf", { spent: formatEuro(budget.spentCents), limit: formatEuro(budget.limitCents) })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <progress
          className={`progress ${progressClass(spent, budget.limitCents)} flex-1`}
          value={Math.min(spent, budget.limitCents)}
          max={budget.limitCents}
          aria-label={name}
        />
        <span className="w-12 text-right text-xs text-base-content/60">{t("percent", { percent })}</span>
        {!readOnly && !editing && (
          <div className="flex shrink-0 gap-0.5">
            <button type="button" className="btn btn-ghost btn-xs font-normal" onClick={() => setEditing(true)}>
              {t("edit")}
            </button>
            <button
              type="button"
              className={`btn btn-xs font-normal ${confirming ? "btn-error" : "btn-ghost text-error"}`}
              disabled={pending}
              onClick={() => (confirming ? send("DELETE") : setConfirming(true))}
            >
              {confirming ? t("confirmDelete") : t("delete")}
            </button>
          </div>
        )}
      </div>
      {!readOnly && editing && (
        <form onSubmit={onSave} className="flex items-center gap-2">
          <input
            className="input input-sm flex-1"
            inputMode="decimal"
            aria-label={t("limitLabel", { category: name })}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
            {t("save")}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
            {t("cancel")}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      )}
    </li>
  );
}

function AddBudgetForm({
  accountId,
  action,
  categoryGroups,
  categoryNames,
}: {
  accountId: string;
  action: string;
  categoryGroups?: ComponentProps<typeof CategorySelect>["groups"];
  categoryNames?: Record<string, string>;
}) {
  const t = useTranslations("budgets");
  const translateKey = useTranslateKey();
  const router = useRouter();
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { accountId, category, limit };
    const parsed = createBudgetSchema.safeParse(input);
    if (!parsed.success) return setError(translateKey(parsed.error.issues[0].message));
    setPending(true);
    setError(null);
    const result = await callApi(action, { json: input });
    setPending(false);
    if (result.status === 409) return setError(t("add.duplicate"));
    if (!result.ok) return setError(t("section.failed"));
    setCategory("");
    setLimit("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-1 flex flex-col gap-1 rounded-box border border-base-300 p-3">
      <h3 className="text-sm font-semibold">{t("add.title")}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <fieldset className="fieldset min-w-40 flex-1">
          <label className="fieldset-legend" htmlFor="budget-category">
            {t("add.category")}
          </label>
          <CategorySelect
            id="budget-category"
            kinds={["expense"]}
            value={category}
            onChange={setCategory}
            emptyLabel={t("add.chooseCategory")}
            groups={categoryGroups}
            names={categoryNames}
          />
        </fieldset>
        <fieldset className="fieldset w-32">
          <label className="fieldset-legend" htmlFor="budget-limit">
            {t("add.limit")}
          </label>
          <input id="budget-limit" className="input w-full" inputMode="decimal" placeholder="400,00" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </fieldset>
        <button type="submit" className="btn mb-1" disabled={pending}>
          {pending && <span className="loading loading-spinner loading-sm" />}
          {t("add.submit")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
