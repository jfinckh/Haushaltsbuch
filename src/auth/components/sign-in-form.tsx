"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "../client/provider";
import { safeRedirectPath, withRedirect } from "../core/redirect";
import { format } from "../i18n/messages";
import { Alert, AuthCard, Field, SubmitButton, useAuthAction } from "./ui";

function providerLabel(id: string) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function SignInFormInner() {
  const { client, routes, features, messages: m } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = safeRedirectPath(params.get("redirectTo"), routes.afterSignIn);
  const { run, pending, error, errorCode } = useAuthAction();
  const resend = useAuthAction();
  const [email, setEmail] = useState("");
  const [resent, setResent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = await run(() =>
      client.signIn.email({
        email: String(form.get("email")),
        password: String(form.get("password")),
        rememberMe: form.get("rememberMe") === "on",
      }),
    );
    if (!result || result.error) return;
    if ("twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
      router.push(withRedirect(routes.twoFactor, redirectTo));
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  async function onPasskey() {
    const result = await run(() => client.signIn.passkey());
    if (result && !result.error) {
      router.push(redirectTo);
      router.refresh();
    }
  }

  async function onResend() {
    const result = await resend.run(() =>
      client.sendVerificationEmail({ email, callbackURL: redirectTo }),
    );
    if (result && !result.error) setResent(true);
  }

  return (
    <AuthCard title={m.signIn.title}>
      {error && <Alert>{error}</Alert>}
      {errorCode === "EMAIL_NOT_VERIFIED" &&
        (resent ? (
          <Alert kind="success">{m.signIn.verificationSent}</Alert>
        ) : (
          <button type="button" className="btn btn-sm btn-outline" onClick={onResend}>
            {m.signIn.resendVerification}
          </button>
        ))}

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field
          label={m.common.email}
          name="email"
          type="email"
          autoComplete="username webauthn"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label={m.common.password}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="rememberMe" className="checkbox checkbox-sm" defaultChecked />
            {m.signIn.rememberMe}
          </label>
          <Link href={routes.forgotPassword} className="link link-hover">
            {m.signIn.forgotPassword}
          </Link>
        </div>
        <SubmitButton pending={pending}>{m.signIn.submit}</SubmitButton>
      </form>

      {(features.passkey || features.socialProviders.length > 0) && (
        <>
          <div className="divider my-0">{m.common.or}</div>
          {features.passkey && (
            <button type="button" className="btn btn-outline" onClick={onPasskey} disabled={pending}>
              {m.signIn.withPasskey}
            </button>
          )}
          {features.socialProviders.map((provider) => (
            <button
              key={provider}
              type="button"
              className="btn btn-outline"
              disabled={pending}
              onClick={() => run(() => client.signIn.social({ provider, callbackURL: redirectTo }))}
            >
              {format(m.signIn.withProvider, { provider: providerLabel(provider) })}
            </button>
          ))}
        </>
      )}

      {features.signUp !== "closed" && (
        <p className="text-sm text-center">
          {m.signIn.noAccount}{" "}
          <Link href={routes.signUp} className="link link-primary">
            {m.signIn.signUpLink}
          </Link>
        </p>
      )}
    </AuthCard>
  );
}

/** Email/password sign-in, plus passkey and OAuth buttons when enabled. */
export function SignInForm() {
  return (
    <Suspense fallback={<span className="loading loading-spinner mx-auto" />}>
      <SignInFormInner />
    </Suspense>
  );
}
