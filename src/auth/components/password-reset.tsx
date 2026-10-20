"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "../client/provider";
import { Alert, AuthCard, Field, SubmitButton, useAuthAction } from "./ui";

/** Asks for an email address and sends a reset link. Never reveals whether the account exists. */
export function ForgotPasswordForm() {
  const { client, routes, messages: m } = useAuth();
  const { run, pending, error } = useAuthAction();
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = await run(() =>
      client.requestPasswordReset({
        email: String(form.get("email")),
        redirectTo: routes.resetPassword,
      }),
    );
    if (result && !result.error) setSent(true);
  }

  return (
    <AuthCard title={m.forgotPassword.title}>
      {sent ? (
        <Alert kind="success">{m.forgotPassword.sent}</Alert>
      ) : (
        <>
          <p className="text-sm">{m.forgotPassword.intro}</p>
          {error && <Alert>{error}</Alert>}
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Field label={m.common.email} name="email" type="email" autoComplete="email" required />
            <SubmitButton pending={pending}>{m.forgotPassword.submit}</SubmitButton>
          </form>
        </>
      )}
      <Link href={routes.signIn} className="link link-hover text-sm text-center">
        {m.forgotPassword.backToSignIn}
      </Link>
    </AuthCard>
  );
}

function ResetPasswordFormInner() {
  const { client, routes, messages: m } = useAuth();
  const params = useSearchParams();
  const token = params.get("token");
  const tokenError = params.get("error");
  const { run, pending, error, setError } = useAuthAction();
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirmPassword"))) {
      setError(m.signUp.passwordMismatch);
      return;
    }
    const result = await run(() => client.resetPassword({ newPassword, token }));
    if (result && !result.error) setDone(true);
  }

  if (!token || tokenError) {
    return (
      <AuthCard title={m.resetPassword.title}>
        <Alert>{m.resetPassword.invalidToken}</Alert>
        <Link href={routes.forgotPassword} className="btn btn-primary">
          {m.resetPassword.requestNew}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={m.resetPassword.title}>
      {done ? (
        <>
          <Alert kind="success">{m.resetPassword.success}</Alert>
          <Link href={routes.signIn} className="btn btn-primary">
            {m.signIn.submit}
          </Link>
        </>
      ) : (
        <>
          {error && <Alert>{error}</Alert>}
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Field
              label={m.resetPassword.newPassword}
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
            <Field
              label={m.signUp.confirmPassword}
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
            />
            <SubmitButton pending={pending}>{m.resetPassword.submit}</SubmitButton>
          </form>
        </>
      )}
    </AuthCard>
  );
}

/** Sets a new password from the `?token=` in the reset link. */
export function ResetPasswordForm() {
  return (
    <Suspense fallback={<span className="loading loading-spinner mx-auto" />}>
      <ResetPasswordFormInner />
    </Suspense>
  );
}
