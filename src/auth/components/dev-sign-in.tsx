"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

export type DevSignInState = { failed: boolean };

type Props = {
  /** Quick buttons, e.g. the seed users. */
  users: readonly { name: string; email: string }[];
  /** Server action: signs in with the form's email (and name), then redirects. */
  action: (state: DevSignInState, form: FormData) => Promise<DevSignInState>;
};

/** Local sign-in without the zero-trust provider. Only shown in dev mode. */
export function DevSignIn({ users, action }: Props) {
  const t = useTranslations("auth.devSignIn");
  const [state, formAction, pending] = useActionState(action, { failed: false });

  return (
    <div className="card bg-base-100 w-full max-w-sm shadow-md">
      <div className="card-body gap-4">
        <h1 className="card-title text-2xl">{t("title")}</h1>
        <div role="note" className="alert alert-warning alert-soft text-sm">{t("note")}</div>
        {state.failed && (
          <div role="alert" className="alert alert-error alert-soft">
            {t("failed")}
          </div>
        )}
        {users.length > 0 && (
          <div className="flex flex-col gap-2">
            {users.map((user) => (
              <form key={user.email} action={formAction}>
                <input type="hidden" name="email" value={user.email} />
                <input type="hidden" name="name" value={user.name} />
                <button type="submit" className="btn btn-primary w-full" disabled={pending}>
                  {t("signInAs", { name: user.name })}
                </button>
              </form>
            ))}
          </div>
        )}
        <form action={formAction} className="flex flex-col gap-2">
          <fieldset className="fieldset">
            <legend className="fieldset-legend">{t("other")}</legend>
            <label className="label" htmlFor="dev-sign-in-email">{t("email")}</label>
            <input id="dev-sign-in-email" name="email" type="email" autoComplete="email" className="input w-full" required />
            <label className="label" htmlFor="dev-sign-in-name">{t("name")}</label>
            <input id="dev-sign-in-name" name="name" type="text" autoComplete="name" className="input w-full" />
          </fieldset>
          <button type="submit" className="btn" disabled={pending}>
            {pending && <span className="loading loading-spinner loading-sm" />}
            {t("submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
