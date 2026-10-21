"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatCents } from "@/shared/money";
import type { AccountView } from "../create-accounts";
import {
  ACCOUNT_ROLES,
  BANK_LABELS,
  BANKS,
  createAccountSchema,
  createTradeRepublicSchema,
  defaultRole,
  ROLE_LABELS,
  TYPE_LABELS,
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

type Errors = Record<string, string>;

function firstErrors(issues: { path: PropertyKey[]; message: string }[]): Errors {
  const errors: Errors = {};
  for (const issue of issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return errors;
}

/** Creates or edits an account. Amounts are typed in German format ("1.234,56"). */
export function AccountForm({ account, action = "/api/accounts", redirectTo = "/" }: Props) {
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
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const iban = bank === "cash" ? null : text("iban");

    let body: unknown;
    if (pair) {
      body = {
        setup: "trade-republic",
        visibility,
        iban,
        clearingOpeningBalance: text("clearingOpeningBalance"),
        depotOpeningBalance: text("depotOpeningBalance"),
      };
      const checked = createTradeRepublicSchema.safeParse(body);
      if (!checked.success) return setErrors(firstErrors(checked.error.issues));
    } else {
      body = { name: text("name"), bank, type, role, openingBalance: text("openingBalance"), iban };
      if (canChangeVisibility) (body as { visibility?: Visibility }).visibility = visibility;
      const checked = editing
        ? updateAccountSchema.safeParse(body)
        : createAccountSchema.safeParse({ ...(body as object), visibility });
      if (!checked.success) return setErrors(firstErrors(checked.error.issues));
    }

    setPending(true);
    setErrors({});
    const response = await fetch(account ? `${action}/${account.id}` : action, {
      method: account ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setPending(false);
    if (!response.ok) {
      const { error } = (await response.json().catch(() => ({}))) as { error?: string };
      return setErrors({ form: error ?? "Could not save the account. Please try again." });
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      <fieldset className="fieldset">
        <label className="fieldset-legend" htmlFor="account-bank">Bank</label>
        <select id="account-bank" className="select w-full" value={bank} onChange={(e) => chooseBank(e.target.value as Bank)}>
          {BANKS.map((b) => (
            <option key={b} value={b}>
              {BANK_LABELS[b]}
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
          Create clearing account (everyday) and depot (savings) together
        </label>
      )}

      {!pair && (
        <>
          <fieldset className="fieldset">
            <label className="fieldset-legend" htmlFor="account-name">Name</label>
            <input
              id="account-name"
              name="name"
              type="text"
              placeholder="e.g. ING Giro"
              defaultValue={account?.name}
              className="input w-full"
              maxLength={60}
              required
            />
            {errors.name && <p className="label text-error">{errors.name}</p>}
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-2">
            <fieldset className="fieldset">
              <label className="fieldset-legend" htmlFor="account-type">Type</label>
              <select id="account-type" className="select w-full" value={type} onChange={(e) => chooseType(e.target.value as AccountType)}>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              {errors.type && <p className="label text-error">{errors.type}</p>}
            </fieldset>
            <fieldset className="fieldset">
              <label className="fieldset-legend" htmlFor="account-role">Role</label>
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
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </fieldset>
          </div>
          <fieldset className="fieldset">
            <label className="fieldset-legend" htmlFor="account-balance">Opening balance (€)</label>
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
            {errors.openingBalance && <p className="label text-error">{errors.openingBalance}</p>}
          </fieldset>
        </>
      )}

      {pair && (
        <div className="grid gap-2 sm:grid-cols-2">
          <fieldset className="fieldset">
            <label className="fieldset-legend" htmlFor="account-clearing-balance">Clearing account balance (€)</label>
            <input id="account-clearing-balance" name="clearingOpeningBalance" type="text" inputMode="decimal" placeholder="0,00" className="input w-full" />
            {errors.clearingOpeningBalance && <p className="label text-error">{errors.clearingOpeningBalance}</p>}
          </fieldset>
          <fieldset className="fieldset">
            <label className="fieldset-legend" htmlFor="account-depot-balance">Depot balance (€)</label>
            <input id="account-depot-balance" name="depotOpeningBalance" type="text" inputMode="decimal" placeholder="0,00" className="input w-full" />
            {errors.depotOpeningBalance && <p className="label text-error">{errors.depotOpeningBalance}</p>}
          </fieldset>
        </div>
      )}

      {bank !== "cash" && (
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="account-iban">
            IBAN {pair ? "of the clearing account " : ""}(optional)
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
          {errors.iban && <p className="label text-error">{errors.iban}</p>}
        </fieldset>
      )}

      <fieldset className="fieldset">
        <legend className="fieldset-legend">Who can see it</legend>
        <label className="label cursor-pointer gap-2 whitespace-normal">
          <input
            type="radio"
            name="visibility"
            className="radio radio-sm"
            checked={visibility === "private"}
            disabled={!canChangeVisibility}
            onChange={() => setVisibility("private")}
          />
          Private: only you. The others do not see that it exists.
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
          Shared: everyone in your household.
        </label>
        {!canChangeVisibility && <p className="label">Only the person who added this account can make it private.</p>}
        {errors.visibility && <p className="label text-error">{errors.visibility}</p>}
      </fieldset>

      {errors.form && (
        <p role="alert" className="text-error">
          {errors.form}
        </p>
      )}
      <button type="submit" className="btn btn-primary mt-2" disabled={pending}>
        {pending && <span className="loading loading-spinner loading-sm" />}
        {editing ? "Save" : pair ? "Add both accounts" : "Add account"}
      </button>
    </form>
  );
}
