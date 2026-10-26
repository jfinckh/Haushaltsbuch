"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatCents, parseGermanAmount } from "@/shared/money";
import { useTranslateKey } from "@/shared/use-translate-key";
import { isCategoryFor, isOwnCategoryKey, type CategoryCatalog } from "../categories";
import type { TransactionView } from "../contract";
import { proposedKind, TRANSACTION_KINDS, type TransactionKind } from "../kinds";
import { today } from "../months";
import { createTransactionSchema } from "../validation";
import { CategorySelect } from "./category-select";

type Props = {
  /** The accounts the user may book on (passed by the app); visibility picks the categories offered. */
  accounts: { id: string; name: string; visibility?: "private" | "shared" }[];
  /** The page's category catalog; without it only the standard categories are offered. */
  categories?: CategoryCatalog;
  /** The booking to edit; without it the form adds a new one. */
  transaction?: TransactionView;
  /** Preselected account for a new booking. */
  accountId?: string;
  /** Endpoint for bookings. Default: /api/transactions */
  action?: string;
  /** Where to go after saving: the booking's account page. Default: /accounts */
  accountsHref?: string;
  /**
   * Offer "Künftig immer so" when the type or category of an edited booking changes: the PATCH then
   * carries `rule: { field, pattern }`, and the app creates a rule from the booking.
   */
  offerRule?: boolean;
  /** Where to go after saving instead of the booking's account page (a checked address from the app). */
  returnTo?: string;
};

type RuleField = "counterparty" | "reference";

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLocaleLowerCase("de");

/** Message keys per field, translated when shown. */
type Errors = Record<string, string>;

function firstErrors(issues: { path: PropertyKey[]; message: string }[]): Errors {
  const errors: Errors = {};
  for (const issue of issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return errors;
}

/** Adds or edits a booking. The type follows the amount's sign until it is chosen by hand. */
export function TransactionForm({
  accounts,
  categories,
  transaction,
  accountId,
  action = "/api/transactions",
  accountsHref = "/accounts",
  offerRule = false,
  returnTo,
}: Props) {
  const t = useTranslations("transactions.form");
  const tKinds = useTranslations("transactions.kinds");
  const tk = useTranslateKey();
  const router = useRouter();
  const editing = Boolean(transaction);
  const [account, setAccount] = useState(transaction?.accountId ?? accountId ?? accounts[0]?.id ?? "");
  const [kind, setKind] = useState<TransactionKind>(transaction?.kind ?? "expense");
  const [kindTouched, setKindTouched] = useState(editing);
  const [category, setCategory] = useState(transaction?.category ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const ruleFields = (["counterparty", "reference"] as const).filter((field) => transaction?.[field]);
  const [learn, setLearn] = useState(false);
  const [ruleField, setRuleField] = useState<RuleField>(ruleFields[0] ?? "counterparty");
  const [rulePattern, setRulePattern] = useState(transaction?.[ruleFields[0] ?? "counterparty"] ?? "");
  const classificationChanged = Boolean(transaction) && (kind !== transaction?.kind || category !== (transaction?.category ?? ""));
  const canLearn = offerRule && classificationChanged && ruleFields.length > 0;
  /** The categories offered on an account: a shared account never offers personal ones. */
  const groupsFor = (accountId: string) =>
    categories && (accounts.find((a) => a.id === accountId)?.visibility === "shared" ? categories.shared : categories.private);
  const offered = (accountId: string, key: string) =>
    groupsFor(accountId)?.some((g) => g.key === key || g.subcategories.some((s) => s.key === key)) ?? false;

  function chooseAccount(next: string) {
    setAccount(next);
    if (isOwnCategoryKey(category) && !offered(next, category)) setCategory("");
  }

  function chooseRuleField(field: RuleField) {
    setRuleField(field);
    setRulePattern(transaction?.[field] ?? "");
  }

  function chooseKind(next: TransactionKind) {
    if (next === kind) return;
    setKind(next);
    // Own categories have a fixed type, so they never fit another one.
    if (category && (isOwnCategoryKey(category) || !isCategoryFor(next, category))) setCategory("");
  }

  function onAmountChange(value: string) {
    const cents = parseGermanAmount(value);
    if (!kindTouched && cents) chooseKind(proposedKind(cents));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const body = {
      accountId: account,
      date: text("date"),
      amount: text("amount"),
      kind,
      category,
      counterparty: text("counterparty"),
      counterpartyIban: text("counterpartyIban"),
      reference: text("reference"),
    };
    // The form always sends every field, so a new and an edited booking follow the same rules.
    const checked = createTransactionSchema.safeParse(body);
    if (!checked.success) return setErrors(firstErrors(checked.error.issues));
    const rule = canLearn && learn ? { field: ruleField, pattern: rulePattern } : undefined;
    if (rule && (!normalize(rule.pattern) || !normalize(transaction?.[ruleField] ?? "").includes(normalize(rule.pattern)))) {
      return setErrors({ rule: "transactions.form.rulePatternNotInText" });
    }

    setPending(true);
    setErrors({});
    const response = await fetch(transaction ? `${action}/${transaction.id}` : action, {
      method: transaction ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rule ? { ...body, rule } : body),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      return setErrors({ form: response?.status === 404 ? "transactions.form.notFound" : "transactions.form.saveFailed" });
    }
    if (rule) {
      const saved = (await response.json().catch(() => ({}))) as { rule?: { created: boolean } };
      if (!saved.rule?.created) {
        router.refresh();
        return setErrors({ rule: "transactions.form.ruleFailed" });
      }
    }
    router.push(returnTo ?? `${accountsHref}/${account}`);
    router.refresh();
  }

  const error = (field: string) => errors[field] && <p className="label text-error">{tk(errors[field])}</p>;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="transaction-amount">{t("amount")}</label>
          <input
            id="transaction-amount"
            name="amount"
            type="text"
            inputMode="decimal"
            placeholder="-12,34"
            defaultValue={transaction ? formatCents(transaction.amountCents) : ""}
            onChange={(e) => onAmountChange(e.target.value)}
            className="input w-full tabular-nums"
            autoFocus={!editing}
            required
          />
          {error("amount")}
          {error("amountCents")}
        </fieldset>
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="transaction-date">{t("date")}</label>
          <input
            id="transaction-date"
            name="date"
            type="date"
            defaultValue={transaction?.date ?? today()}
            className="input w-full"
            required
          />
          {error("date")}
          {error("bookingDate")}
        </fieldset>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="transaction-kind">{t("kind")}</label>
          <select
            id="transaction-kind"
            className="select w-full"
            value={kind}
            onChange={(e) => {
              setKindTouched(true);
              chooseKind(e.target.value as TransactionKind);
            }}
          >
            {TRANSACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {tKinds(k)}
              </option>
            ))}
          </select>
        </fieldset>
        {(kind === "expense" || kind === "income") && (
          <fieldset className="fieldset">
            <label className="fieldset-legend" htmlFor="transaction-category">{t("category")}</label>
            <CategorySelect
              id="transaction-category"
              kinds={[kind]}
              value={category}
              onChange={setCategory}
              emptyLabel={t("noCategory")}
              groups={groupsFor(account)}
              names={categories?.names}
            />
            {error("category")}
          </fieldset>
        )}
      </div>

      {transaction?.classifiedBy === "rule" && !classificationChanged && (
        <p className="text-base-content/70 text-sm">{t("classifiedByRule")}</p>
      )}

      {canLearn && (
        <div className="bg-base-200 rounded-box flex flex-col gap-2 p-3">
          <label className="label cursor-pointer justify-start gap-2 whitespace-normal">
            <input type="checkbox" className="checkbox checkbox-sm" checked={learn} onChange={(e) => setLearn(e.target.checked)} />
            <span className="text-base-content font-medium">{t("learnRule")}</span>
          </label>
          {learn && (
            <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
              <select
                aria-label={t("ruleField")}
                className="select select-sm"
                value={ruleField}
                onChange={(e) => chooseRuleField(e.target.value as RuleField)}
              >
                {ruleFields.map((field) => (
                  <option key={field} value={field}>
                    {t(field === "counterparty" ? "ruleFieldCounterparty" : "ruleFieldReference")}
                  </option>
                ))}
              </select>
              <input
                aria-label={t("rulePattern")}
                type="text"
                className="input input-sm w-full"
                value={rulePattern}
                maxLength={200}
                onChange={(e) => setRulePattern(e.target.value)}
              />
              <p className="text-base-content/70 text-xs sm:col-span-2">{t("learnRuleHint")}</p>
            </div>
          )}
          {error("rule")}
        </div>
      )}

      <fieldset className="fieldset">
        <label className="fieldset-legend" htmlFor="transaction-counterparty">{t("counterparty")}</label>
        <input
          id="transaction-counterparty"
          name="counterparty"
          type="text"
          placeholder={t("counterpartyPlaceholder")}
          defaultValue={transaction?.counterparty ?? ""}
          className="input w-full"
          maxLength={200}
        />
        {error("counterparty")}
      </fieldset>

      <fieldset className="fieldset">
        <label className="fieldset-legend" htmlFor="transaction-reference">{t("reference")}</label>
        <input
          id="transaction-reference"
          name="reference"
          type="text"
          defaultValue={transaction?.reference ?? ""}
          className="input w-full"
          maxLength={500}
        />
        {error("reference")}
      </fieldset>

      <fieldset className="fieldset">
        <label className="fieldset-legend" htmlFor="transaction-account">{t("account")}</label>
        <select id="transaction-account" className="select w-full" value={account} onChange={(e) => chooseAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {error("accountId")}
      </fieldset>

      <details className="collapse collapse-arrow bg-base-200" open={Boolean(transaction?.counterpartyIban || errors.counterpartyIban)}>
        <summary className="collapse-title text-sm">{t("more")}</summary>
        <div className="collapse-content">
          <fieldset className="fieldset">
            <label className="fieldset-legend" htmlFor="transaction-iban">{t("iban")}</label>
            <input
              id="transaction-iban"
              name="counterpartyIban"
              type="text"
              autoComplete="off"
              placeholder="DE00 0000 0000 0000 0000 00"
              defaultValue={transaction?.counterpartyIban ?? ""}
              className="input w-full font-mono"
            />
            {error("counterpartyIban")}
          </fieldset>
        </div>
      </details>

      {errors.form && (
        <p role="alert" className="text-error">
          {tk(errors.form)}
        </p>
      )}
      <button type="submit" className="btn btn-primary mt-2" disabled={pending || accounts.length === 0}>
        {pending && <span className="loading loading-spinner loading-sm" />}
        {editing ? t("save") : t("add")}
      </button>
    </form>
  );
}
