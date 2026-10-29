"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callApi } from "@/shared/api-client";
import { formatCents } from "@/shared/money";
import { useTranslateKey } from "@/shared/use-translate-key";
import type { AccountView } from "../contract";
import {
  ACCOUNT_ROLES,
  BANKS,
  createAccountSchema,
  createTradeRepublicSchema,
  defaultRole,
  TYPES_BY_BANK,
  updateAccountSchema,
  type AccountRole,
  type AccountType,
  type Bank,
  type Visibility,
} from "../validation";

type Props = {
  /** The account to edit; without it the form creates a new one. */
  account?: AccountView;
  /** Endpoint for accounts. Default: /api/accounts */
  action?: string;
  /** Where to go after saving. Default: / */
  redirectTo?: string;
};

/** Message keys per field, translated when shown. */
type Errors = Record<string, string>;

function firstErrors(issues: { path: PropertyKey[]; message: string }[]): Errors {
  const errors: Errors = {};
  for (const issue of issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return errors;
}

/** Creates or edits an account. Amounts are typed in German format ("1.234,56"). */
export function AccountForm({ account, action = "/api/accounts", redirectTo = "/" }: Props) {
  const t = useTranslations("accounts");
  const tk = useTranslateKey();
  const router = useRouter();
  const editing = Boolean(account);
  const [bank, setBank] = useState<Bank>(account?.bank ?? "ing");
  const [type, setType] = useState<AccountType>(account?.type ?? "checking");
  const [role, setRole] = useState<AccountRole>(account?.role ?? "everyday");
  const [roleTouched, setRoleTouched] = useState(editing);
  const [visibility, setVisibility] = useState<Visibility>(account?.visibility ?? "private");
  const [tradeRepublicPair, setTradeRepublicPair] = useState(!editing);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  const pair = !editing && bank === "trade_republic" && tradeRepublicPair;
  const types = TYPES_BY_BANK[bank];
  const canChangeVisibility = !account || account.ownedByMe;

  function chooseBank(next: Bank) {
    setBank(next);
    const nextType = TYPES_BY_BANK[next].includes(type) ? type : TYPES_BY_BANK[next][0];
    chooseType(nextType);
  }

  function chooseType(next: AccountType) {
    setType(next);
    if (!roleTouched) setRole(defaultRole(next));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const text = (name: string) => String(form.get(name) ?? "");
    const iban = bank === "cash" ? null : text("iban");

    let body: unknown;
    if (pair) {
      body = {
        setup: "trade-republic",
        visibility,
        iban,
      };
      const checked = createTradeRepublicSchema.safeParse(body);
      if (!checked.success) return setErrors(firstErrors(checked.error.issues));
    } else {
      // A new account starts at 0 €; the first bank statement import sets its balance.
      body = { name: text("name"), bank, type, role, iban, ...(editing && { openingBalance: text("openingBalance") }) };
      if (canChangeVisibility) (body as { visibility?: Visibility }).visibility = visibility;
      const checked = editing
        ? updateAccountSchema.safeParse(body)
        : createAccountSchema.safeParse({ ...(body as object), visibility });
      if (!checked.success) return setErrors(firstErrors(checked.error.issues));
    }

    setPending(true);
    setErrors({});
    const result = await callApi(account ? `${action}/${account.id}` : action, { method: account ? "PATCH" : "POST", json: body });
    setPending(false);
    if (!result.ok) {
      const form =
        result.status === 403
          ? "accounts.form.notOwner"
          : result.status === 409
            ? "accounts.form.noHousehold"
            : "accounts.form.saveFailed";
      return setErrors({ form });
    }
    // Next keeps visited pages alive (cacheComponents), so a later visit would show these inputs again.
    if (!editing) {
      formElement.reset();
      setBank("ing");
      setType("checking");
      setRole("everyday");
      setRoleTouched(false);
      setVisibility("private");
      setTradeRepublicPair(true);
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      <fieldset className="fieldset">
        <label className="fieldset-legend" htmlFor="account-bank">{t("form.bank")}</label>
        <select id="account-bank" className="select w-full" value={bank} onChange={(e) => chooseBank(e.target.value as Bank)}>
          {BANKS.map((b) => (
            <option key={b} value={b}>
              {t(`banks.${b}`)}
            </option>
          ))}
        </select>
      </fieldset>

      {!editing && bank === "trade_republic" && (
        <label className="label cursor-pointer gap-2 whitespace-normal">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={tradeRepublicPair}
            onChange={(e) => setTradeRepublicPair(e.target.checked)}
          />
          {t("form.tradeRepublicPair")}
        </label>
      )}

      {!pair && (
        <>
          <fieldset className="fieldset">
            <label className="fieldset-legend" htmlFor="account-name">{t("form.name")}</label>
            <input
              id="account-name"
              name="name"
              type="text"
              placeholder={t("form.namePlaceholder")}
              defaultValue={account?.name}
              className="input w-full"
              maxLength={60}
              required
            />
            {errors.name && <p className="label text-error">{tk(errors.name)}</p>}
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-2">
            <fieldset className="fieldset">
              <label className="fieldset-legend" htmlFor="account-type">{t("form.type")}</label>
              <select id="account-type" className="select w-full" value={type} onChange={(e) => chooseType(e.target.value as AccountType)}>
                {types.map((option) => (
                  <option key={option} value={option}>
                    {t(`types.${option}`)}
                  </option>
                ))}
              </select>
              {errors.type && <p className="label text-error">{tk(errors.type)}</p>}
            </fieldset>
            <fieldset className="fieldset">
              <label className="fieldset-legend" htmlFor="account-role">{t("form.role")}</label>
              <select
                id="account-role"
                className="select w-full"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as AccountRole);
                  setRoleTouched(true);
                }}
              >
                {ACCOUNT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </select>
            </fieldset>
          </div>
          {editing && (
            <fieldset className="fieldset">
              <label className="fieldset-legend" htmlFor="account-balance">{t("form.openingBalance")}</label>
              <input
                id="account-balance"
                name="openingBalance"
                type="text"
                inputMode="decimal"
                placeholder="1.234,56"
                defaultValue={account ? formatCents(account.openingBalanceCents) : ""}
                className="input w-full"
                required
              />
              {errors.openingBalance && <p className="label text-error">{tk(errors.openingBalance)}</p>}
            </fieldset>
          )}
        </>
      )}

      {!editing && <p className="text-sm text-base-content/70">{t("form.balanceFromImport")}</p>}

      {bank !== "cash" && (
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="account-iban">
            {pair ? t("form.ibanOfClearing") : t("form.iban")}
          </label>
          <input
            id="account-iban"
            name="iban"
            type="text"
            autoComplete="off"
            placeholder="DE00 0000 0000 0000 0000 00"
            defaultValue={account?.iban ?? ""}
            className="input w-full font-mono"
          />
          {errors.iban && <p className="label text-error">{tk(errors.iban)}</p>}
        </fieldset>
      )}

      <fieldset className="fieldset">
        <legend className="fieldset-legend">{t("form.whoCanSee")}</legend>
        <label className="label cursor-pointer gap-2 whitespace-normal">
          <input
            type="radio"
            name="visibility"
            className="radio radio-sm"
            checked={visibility === "private"}
            disabled={!canChangeVisibility}
            onChange={() => setVisibility("private")}
          />
          {t("form.private")}
        </label>
        <label className="label cursor-pointer gap-2 whitespace-normal">
          <input
            type="radio"
            name="visibility"
            className="radio radio-sm"
            checked={visibility === "shared"}
            disabled={!canChangeVisibility}
            onChange={() => setVisibility("shared")}
          />
          {t("form.shared")}
        </label>
        {!canChangeVisibility && <p className="label">{t("form.onlyOwnerCanMakePrivate")}</p>}
        {errors.visibility && <p className="label text-error">{tk(errors.visibility)}</p>}
      </fieldset>

      {errors.form && (
        <p role="alert" className="text-error">
          {tk(errors.form)}
        </p>
      )}
      <button type="submit" className="btn btn-primary mt-2" disabled={pending}>
        {pending && <span className="loading loading-spinner loading-sm" />}
        {editing ? t("form.save") : pair ? t("form.addBoth") : t("form.add")}
      </button>
    </form>
  );
}
