"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "../client/provider";
import { safeRedirectPath } from "../core/redirect";
import { Alert, AuthCard, Field, SubmitButton, useAuthAction } from "./ui";

function TwoFactorFormInner() {
  const { client, routes, messages: m } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = safeRedirectPath(params.get("redirectTo"), routes.afterSignIn);
  const { run, pending, error } = useAuthAction();
  const [useBackup, setUseBackup] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const code = String(form.get("code")).replace(/\s/g, "");
    const trustDevice = form.get("trustDevice") === "on";
    const result = await run(() =>
      useBackup
        ? client.twoFactor.verifyBackupCode({ code, trustDevice })
        : client.twoFactor.verifyTotp({ code, trustDevice }),
    );
    if (result && !result.error) {
      router.push(redirectTo);
      router.refresh();
    }
  }

  return (
    <AuthCard title={m.twoFactor.title}>
      {!useBackup && <p className="text-sm">{m.twoFactor.intro}</p>}
      {error && <Alert>{error}</Alert>}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field
          key={useBackup ? "backup" : "totp"}
          label={useBackup ? m.twoFactor.backupCode : m.twoFactor.code}
          name="code"
          autoComplete="one-time-code"
          inputMode={useBackup ? "text" : "numeric"}
          pattern={useBackup ? undefined : "[0-9 ]{6,7}"}
          autoFocus
          required
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="trustDevice" className="checkbox checkbox-sm" />
          {m.twoFactor.trustDevice}
        </label>
        <SubmitButton pending={pending}>{m.twoFactor.submit}</SubmitButton>
      </form>
      <button type="button" className="btn btn-link btn-sm" onClick={() => setUseBackup(!useBackup)}>
        {useBackup ? m.twoFactor.useTotp : m.twoFactor.useBackupCode}
      </button>
    </AuthCard>
  );
}

/** Second sign-in step for users with 2FA turned on. */
export function TwoFactorForm() {
  return (
    <Suspense fallback={<span className="loading loading-spinner mx-auto" />}>
      <TwoFactorFormInner />
    </Suspense>
  );
}
