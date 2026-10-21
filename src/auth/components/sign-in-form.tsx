"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "../client";
import { signInSchema } from "../validation";
import { fieldErrors, useTranslateKey } from "./field-errors";

type Props = {
  /** Where to go after signing in. Default: / */
  redirectTo?: string;
  /** Link to the sign-up page. Omit to hide the link. */
  signUpHref?: string;
};

export function SignInForm({ redirectTo = "/", signUpHref }: Props) {
  const t = useTranslations("auth");
  const tk = useTranslateKey();
  const router = useRouter();
  // Message keys, translated when shown.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = signInSchema.safeParse({ email: form.get("email"), password: form.get("password") });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));

    setPending(true);
    setErrors({});
    const { error } = await authClient.signIn.email(parsed.data);
    setPending(false);
    if (error) {
      const wrong = error.status === 401 || error.code === "INVALID_EMAIL_OR_PASSWORD";
      return setErrors({ form: wrong ? "auth.signIn.wrongCredentials" : "auth.signIn.failed" });
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="card bg-base-100 w-full max-w-sm shadow-md">
      <div className="card-body gap-3">
        <h1 className="card-title text-2xl">{t("signIn.title")}</h1>
        {errors.form && (
          <div role="alert" className="alert alert-error alert-soft">
            {tk(errors.form)}
          </div>
        )}
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="sign-in-email">{t("fields.email")}</label>
          <input id="sign-in-email" name="email" type="email" autoComplete="email" className="input w-full" required />
          {errors.email && <p className="label text-error">{tk(errors.email)}</p>}
          <label className="fieldset-legend" htmlFor="sign-in-password">{t("fields.password")}</label>
          <input id="sign-in-password" name="password" type="password" autoComplete="current-password" className="input w-full" required />
          {errors.password && <p className="label text-error">{tk(errors.password)}</p>}
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending && <span className="loading loading-spinner loading-sm" />}
          {t("signIn.submit")}
        </button>
        {signUpHref && (
          <p className="text-sm">
            {t("signIn.noAccount")}{" "}
            <Link href={signUpHref} className="link link-primary">
              {t("signIn.signUpLink")}
            </Link>
          </p>
        )}
      </div>
    </form>
  );
}
