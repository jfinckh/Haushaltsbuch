"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type ComponentProps, type FormEvent } from "react";
import { callApi } from "@/shared/api-client";
import { formatCents, parseGermanAmount } from "@/shared/money";
import { useTranslateKey } from "@/shared/use-translate-key";
import { CategorySelect, isCategoryFor, isOwnCategoryKey, TRANSACTION_KINDS, type TransactionKind } from "@/transactions";
import type { TemplateView } from "../contract";
import { INTERVAL_MONTHS, templateInputSchema } from "../validation";

type CategoryGroups = NonNullable<ComponentProps<typeof CategorySelect>["groups"]>;

/** Values a new template can start with (e.g. from a suggestion in step 2b). */
export type TemplateFormValues = {
  accountId: string;
  amountCents: number;
  kind: TransactionKind;
  category: string | null;
  counterparty: string | null;
  counterpartyIban: string | null;
  reference: string | null;
  intervalMonths: (typeof INTERVAL_MONTHS)[number];
  nextDueDate: string;
};

type Props = {
  /** The accounts the user may use (passed by the app); visibility picks the categories offered. */
  accounts: { id: string; name: string; visibility?: "private" | "shared" }[];
  /** The page's category catalog; without it only the standard categories are offered. */
  categories?: { shared: CategoryGroups; private: CategoryGroups; names?: Record<string, string> };
  /** The template to edit; without it the form creates a new one. */
  template?: TemplateView;
  /** Starting values for a new template. */
  initial?: Partial<TemplateFormValues>;
  /** Endpoint for templates. Default: /api/recurring */
  action?: string;
  /** Where to go after saving. Default: /recurring */
  returnTo?: string;
  /** Today (YYYY-MM-DD), the earliest next date. Default: today in Germany, like the hourly run. */
  today?: string;
};

const todayInGermany = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

const INTERVAL_LABELS = { 1: "monthly", 3: "quarterly", 6: "halfYearly", 12: "yearly" } as const;

type MonthChoice = "auto" | "booking" | "next";

const choiceOf = (value: boolean | null | undefined): MonthChoice => (value === true ? "next" : value === false ? "booking" : "auto");

type Errors = Record<string, string>;

/** Creates or edits a regular booking. The type follows the amount's sign until it is chosen by hand. */
export function TemplateForm({ accounts, categories, template, initial, action = "/api/recurring", returnTo = "/recurring", today = todayInGermany() }: Props) {
  const t = useTranslations("recurring.form");
  const tKinds = useTranslations("transactions.kinds");
  const tk = useTranslateKey();
  const router = useRouter();
  const start = template ?? initial;
  const [account, setAccount] = useState(start?.accountId ?? accounts[0]?.id ?? "");
  const [kind, setKind] = useState<TransactionKind>(start?.kind ?? "expense");
  const [kindTouched, setKindTouched] = useState(Boolean(template));
  const [category, setCategory] = useState(start?.category ?? "");
  const [interval, setIntervalMonths] = useState<number>(start?.intervalMonths ?? 1);
  const [monthChoice, setMonthChoice] = useState<MonthChoice>(choiceOf(template?.countsNextMonth));
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  const groupsFor = (accountId: string) =>
    categories && (accounts.find((a) => a.id === accountId)?.visibility === "shared" ? categories.shared : categories.private);

  /** A paused template may keep its past next date; resume moves it forward. */
  const keepsPausedDate = (date: string) => template?.status === "paused" && date === template.nextDueDate;

  /** Whether the account offers the category (a shared account never offers personal ones). */
  const offered = (accountId: string, key: string) =>
    groupsFor(accountId)?.some((g) => g.key === key || g.subcategories.some((sub) => sub.key === key)) ?? false;

  function chooseAccount(next: string) {
    setAccount(next);
    if (isOwnCategoryKey(category) && !offered(next, category)) setCategory("");
  }

  function chooseKind(next: TransactionKind) {
    if (next === kind) return;
    setKind(next);
    if (category && (isOwnCategoryKey(category) || !isCategoryFor(next, category))) setCategory("");
  }

  function onAmountChange(value: string) {
    const cents = parseGermanAmount(value);
    if (!kindTouched && cents) chooseKind(cents < 0 ? "expense" : "income");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const body = {
      accountId: account,
      amount: text("amount"),
      kind,
      category: kind === "expense" || kind === "income" ? category : "",
      counterparty: text("counterparty"),
      counterpartyIban: text("counterpartyIban"),
      reference: text("reference"),
      countsNextMonth: kind === "transfer" || monthChoice === "auto" ? null : monthChoice === "next",
      intervalMonths: interval,
      nextDueDate: text("nextDueDate"),
      endDate: text("endDate") || null,
    };
    const checked = templateInputSchema.safeParse(body);
    const found: Errors = {};
    if (!checked.success) for (const issue of checked.error.issues) found[String(issue.path[0] ?? "form")] ??= issue.message;
    if (body.nextDueDate && body.nextDueDate < today && !keepsPausedDate(body.nextDueDate)) found.nextDueDate ??= "recurring.validation.nextDueInPast";
    if (Object.keys(found).length > 0) return setErrors(found);

    setPending(true);
    setErrors({});
    const result = await callApi(template ? `${action}/${template.id}` : action, { method: template ? "PATCH" : "POST", json: body });
    setPending(false);
    if (!result.ok) return setErrors({ form: result.status === 404 ? "recurring.form.notFound" : "recurring.form.saveFailed" });
    router.push(returnTo);
    router.refresh();
  }

  const error = (field: string) => errors[field] && <p className="label text-error whitespace-normal">{tk(errors[field])}</p>;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      {template && <p className="text-sm text-base-content/70">{t("futureOnly")}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="template-amount">{t("amount")}</label>
          <input
            id="template-amount"
            name="amount"
            type="text"
            inputMode="decimal"
            placeholder="-12,34"
            defaultValue={start?.amountCents !== undefined ? formatCents(start.amountCents) : ""}
            onChange={(e) => onAmountChange(e.target.value)}
            className="input w-full tabular-nums"
            autoFocus={!template}
          />
          {error("amount")}
        </fieldset>
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="template-next">{t("nextDueDate")}</label>
          <input
            id="template-next"
            name="nextDueDate"
            type="date"
            min={template && keepsPausedDate(template.nextDueDate) ? undefined : today}
            defaultValue={start?.nextDueDate ?? ""}
            className="input w-full"
          />
          {error("nextDueDate")}
        </fieldset>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="template-kind">{t("kind")}</label>
          <select
            id="template-kind"
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
            <label className="fieldset-legend" htmlFor="template-category">{t("category")}</label>
            <CategorySelect
              id="template-category"
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

      <div className="grid gap-2 sm:grid-cols-2">
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="template-interval">{t("interval")}</label>
          <select id="template-interval" className="select w-full" value={interval} onChange={(e) => setIntervalMonths(Number(e.target.value))}>
            {INTERVAL_MONTHS.map((months) => (
              <option key={months} value={months}>
                {t(`intervals.${INTERVAL_LABELS[months]}`)}
              </option>
            ))}
          </select>
        </fieldset>
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="template-end">{t("endDate")}</label>
          <input id="template-end" name="endDate" type="date" min={today} defaultValue={template?.endDate ?? ""} className="input w-full" />
          {error("endDate")}
        </fieldset>
      </div>

      <fieldset className="fieldset">
        <label className="fieldset-legend" htmlFor="template-counterparty">{t("counterparty")}</label>
        <input id="template-counterparty" name="counterparty" type="text" maxLength={200} defaultValue={start?.counterparty ?? ""} className="input w-full" />
        {error("counterparty")}
      </fieldset>

      <fieldset className="fieldset">
        <label className="fieldset-legend" htmlFor="template-reference">{t("reference")}</label>
        <input id="template-reference" name="reference" type="text" maxLength={500} defaultValue={start?.reference ?? ""} className="input w-full" />
        {error("reference")}
      </fieldset>

      <fieldset className="fieldset">
        <label className="fieldset-legend" htmlFor="template-account">{t("account")}</label>
        <select id="template-account" className="select w-full" value={account} onChange={(e) => chooseAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {error("accountId")}
      </fieldset>

      {kind !== "transfer" && (
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="template-month">{t("countsFor")}</label>
          <select id="template-month" className="select w-full" value={monthChoice} onChange={(e) => setMonthChoice(e.target.value as MonthChoice)}>
            <option value="auto">{t("countsForAuto")}</option>
            <option value="booking">{t("countsForBookingMonth")}</option>
            <option value="next">{t("countsForNextMonth")}</option>
          </select>
        </fieldset>
      )}

      <details className="collapse collapse-arrow bg-base-200" open={Boolean(start?.counterpartyIban || errors.counterpartyIban)}>
        <summary className="collapse-title text-sm">{t("more")}</summary>
        <div className="collapse-content">
          <fieldset className="fieldset">
            <label className="fieldset-legend" htmlFor="template-iban">{t("iban")}</label>
            <input
              id="template-iban"
              name="counterpartyIban"
              type="text"
              autoComplete="off"
              placeholder="DE00 0000 0000 0000 0000 00"
              defaultValue={start?.counterpartyIban ?? ""}
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
        {template ? t("save") : t("create")}
      </button>
    </form>
  );
}
