"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { callApi } from "@/shared/api-client";
import { useTranslateKey } from "@/shared/use-translate-key";
import { useState, type FormEvent } from "react";
import { createHouseholdSchema } from "../validation";

type Props = {
  /** Endpoint that creates the household. Default: /api/households */
  action?: string;
  /** Where to go after creating it. Default: / */
  redirectTo?: string;
};

export function CreateHouseholdForm({ action = "/api/households", redirectTo = "/" }: Props) {
  const t = useTranslations("households.create");
  const tk = useTranslateKey();
  const router = useRouter();
  // A message key, translated when shown.
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = createHouseholdSchema.safeParse({ name: form.get("name") });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "households.validation.nameRequired");

    setPending(true);
    setError(null);
    const result = await callApi(action, { json: parsed.data });
    setPending(false);
    // 409: the user is already in a household; the target page shows it.
    if (!result.ok && result.status !== 409) return setError("households.create.failed");
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="card bg-base-100 w-full max-w-sm shadow-md">
      <div className="card-body gap-3">
        <h1 className="card-title text-2xl">{t("title")}</h1>
        <p className="opacity-70">{t("intro")}</p>
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="household-name">{t("nameLabel")}</label>
          <input id="household-name" name="name" type="text" placeholder={t("namePlaceholder")} className="input w-full" required maxLength={100} />
          {error && <p className="label text-error">{tk(error)}</p>}
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending && <span className="loading loading-spinner loading-sm" />}
          {t("submit")}
        </button>
      </div>
    </form>
  );
}
