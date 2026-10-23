"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type ComponentProps, type FormEvent } from "react";
import { useTranslateKey } from "@/shared/use-translate-key";
import { CategorySelect, isCategoryFor, isOwnCategoryKey, TRANSACTION_KINDS, type TransactionKind } from "@/transactions";
import type { RuleAccount, RuleScope, RuleView } from "../types";
import { ruleInputSchema } from "../validation";
import { useRuleTexts } from "./use-rule-texts";

type Props = {
  /** The accounts the user may see (passed by the app). */
  accounts: RuleAccount[];
  /** The page's category catalog; without it only the standard categories are offered. */
  categories?: { names: Record<string, string>; shared: CategoryGroups; private: CategoryGroups };
  /** The rule to edit; without it the form creates a new one. */
  rule?: RuleView;
  /** Endpoint for rules. Default: /api/rules */
  action?: string;
  /** Where to go after saving. Default: /rules */
  rulesHref?: string;
};

type Errors = Record<string, string>;

type CategoryGroups = NonNullable<ComponentProps<typeof CategorySelect>["groups"]>;

const scopeValue = (scope: RuleScope) => (scope.type === "account" ? `account:${scope.accountId}` : scope.type);

function scopeFrom(value: string): RuleScope {
  if (value.startsWith("account:")) return { type: "account", accountId: value.slice("account:".length) };
  return { type: value === "private" ? "private" : "shared" };
}

/** Creates or edits a rule: where it applies, what it looks for and what it sets. */
export function RuleForm({ accounts, categories, rule, action = "/api/rules", rulesHref = "/rules" }: Props) {
  const t = useTranslations("rules.form");
  const tKinds = useTranslations("rules.kinds");
  const tk = useTranslateKey();
  const texts = useRuleTexts(accounts, categories?.names);
  const router = useRouter();
  const [scope, setScope] = useState(rule ? scopeValue(rule.scope) : accounts[0] ? `account:${accounts[0].id}` : "shared");
  const [kind, setKind] = useState<TransactionKind>(rule?.kind ?? "expense");
  const [category, setCategory] = useState(rule?.category ?? "");
  const [external, setExternal] = useState(rule?.transferTarget === "external");
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  const scopes: RuleScope[] = [
    ...accounts.map((a): RuleScope => ({ type: "account", accountId: a.id })),
    { type: "shared" },
    { type: "private" },
  ];
  const hasCategory = kind === "expense" || kind === "income";
  const hasTarget = kind === "transfer" || kind === "saving";

  /**
   * The categories a rule in this scope may set: one account's choice, the household's shared accounts
   * (never personal categories) or the caller's private accounts.
   */
  const groupsFor = (value: string) => {
    if (!categories) return undefined;
    const target = scopeFrom(value);
    const shared = target.type === "account" ? accounts.find((a) => a.id === target.accountId)?.visibility === "shared" : target.type === "shared";
    return shared ? categories.shared : categories.private;
  };

  function chooseScope(next: string) {
    setScope(next);
    const offered = groupsFor(next)?.some((g) => g.key === category || g.subcategories.some((s) => s.key === category));
    if (isOwnCategoryKey(category) && !offered) setCategory("");
  }

  function chooseKind(next: TransactionKind) {
    if (next === kind) return;
    setKind(next);
    // Own categories have a fixed type, so they never fit another one.
    if (category && (isOwnCategoryKey(category) || !isCategoryFor(next, category))) setCategory("");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      scope: scopeFrom(scope),
      counterparty: String(form.get("counterparty") ?? ""),
      reference: String(form.get("reference") ?? ""),
      amountSign: String(form.get("amountSign") ?? ""),
      kind,
      category: hasCategory ? category : "",
      transferTarget: hasTarget && external ? "external" : "",
    };
    const checked = ruleInputSchema.safeParse(body);
    if (!checked.success) {
      const found: Errors = {};
      for (const issue of checked.error.issues) found[String(issue.path[0] ?? "form")] ??= issue.message;
      return setErrors(found);
    }
    setPending(true);
    setErrors({});
    const response = await fetch(rule ? `${action}/${rule.id}` : action, {
      method: rule ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      const reason = response && ((await response.json().catch(() => ({}))) as { error?: string }).error;
      const message =
        response?.status === 404 ? "rules.form.notFound" : reason === "no-household" ? "rules.form.noHousehold" : "rules.form.saveFailed";
      return setErrors({ form: message });
    }
    router.push(rulesHref);
    router.refresh();
  }

  const error = (field: string) => errors[field] && <p className="label text-error">{tk(errors[field])}</p>;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      <fieldset className="fieldset">
        <label className="fieldset-legend" htmlFor="rule-scope">{t("scope")}</label>
        <select id="rule-scope" className="select w-full" value={scope} onChange={(e) => chooseScope(e.target.value)}>
          {scopes.map((s) => (
            <option key={scopeValue(s)} value={scopeValue(s)}>
              {texts.scope(s)}
            </option>
          ))}
        </select>
        <p className="label whitespace-normal">{t("scopeHint")}</p>
      </fieldset>

      <h2 className="mt-2 font-semibold">{t("condition")}</h2>
      <fieldset className="fieldset">
        <label className="fieldset-legend" htmlFor="rule-counterparty">{t("counterparty")}</label>
        <input id="rule-counterparty" name="counterparty" type="text" defaultValue={rule?.counterparty ?? ""} className="input w-full" maxLength={200} />
        {error("counterparty")}
      </fieldset>
      <fieldset className="fieldset">
        <label className="fieldset-legend" htmlFor="rule-reference">{t("reference")}</label>
        <input id="rule-reference" name="reference" type="text" defaultValue={rule?.reference ?? ""} className="input w-full" maxLength={200} />
        <p className="label whitespace-normal">{t("patternHint")}</p>
        {error("reference")}
      </fieldset>
      <fieldset className="fieldset">
        <label className="fieldset-legend" htmlFor="rule-sign">{t("amountSign")}</label>
        <select id="rule-sign" name="amountSign" className="select w-full" defaultValue={rule?.amountSign ?? ""}>
          <option value="">{t("anySign")}</option>
          <option value="negative">{t("negative")}</option>
          <option value="positive">{t("positive")}</option>
        </select>
      </fieldset>

      <h2 className="mt-2 font-semibold">{t("result")}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="rule-kind">{t("kind")}</label>
          <select id="rule-kind" className="select w-full" value={kind} onChange={(e) => chooseKind(e.target.value as TransactionKind)}>
            {TRANSACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {tKinds(k)}
              </option>
            ))}
          </select>
        </fieldset>
        {hasCategory && (
          <fieldset className="fieldset">
            <label className="fieldset-legend" htmlFor="rule-category">{t("category")}</label>
            <CategorySelect
              id="rule-category"
              kinds={[kind]}
              value={category}
              onChange={setCategory}
              emptyLabel={t("noCategory")}
              groups={groupsFor(scope)}
              names={categories?.names}
            />
            {error("category")}
          </fieldset>
        )}
      </div>
      {hasTarget && (
        <label className="label cursor-pointer gap-2 whitespace-normal">
          <input type="checkbox" className="checkbox checkbox-sm" checked={external} onChange={(e) => setExternal(e.target.checked)} />
          <span>{t("external")}</span>
        </label>
      )}
      {error("transferTarget")}

      {errors.form && (
        <p role="alert" className="text-error">
          {tk(errors.form)}
        </p>
      )}
      <button type="submit" className="btn btn-primary mt-2" disabled={pending}>
        {pending && <span className="loading loading-spinner loading-sm" />}
        {rule ? t("save") : t("create")}
      </button>
    </form>
  );
}
