"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "../client/provider";
import { safeRedirectPath } from "../core/redirect";
import { INVITE_HEADER } from "../core/types";
import { format } from "../i18n/messages";
import { Alert, AuthCard, Field, SubmitButton, useAuthAction } from "./ui";

function SignUpFormInner() {
  const { client, routes, features, messages: m } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const inviteToken = params.get("invite");
  const redirectTo = safeRedirectPath(params.get("redirectTo"), routes.afterSignIn);
  const { run, pending, error, setError } = useAuthAction();
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirmPassword"))) {
      setError(m.signUp.passwordMismatch);
      return;
    }
    const email = String(form.get("email"));
    const result = await run(() =>
      client.signUp.email(
        {
          name: String(form.get("name")),
          email,
          password,
          callbackURL: redirectTo,
        },
        { headers: inviteToken ? { [INVITE_HEADER]: inviteToken } : undefined },
      ),
    );
    if (!result || result.error) return;
    if (features.requireEmailVerification) {
      setSentTo(email);
    } else {
      router.push(redirectTo);
      router.refresh();
    }
  }

  if (sentTo) {
    return (
      <AuthCard title={m.signUp.title}>
        <Alert kind="success">{format(m.signUp.checkInbox, { email: sentTo })}</Alert>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={m.signUp.title}>
      {features.signUp === "invite-only" && !inviteToken && (
        <Alert kind="info">{m.signUp.inviteRequired}</Alert>
      )}
      {features.signUp === "closed" && <Alert kind="info">{m.signUp.closed}</Alert>}
      {error && <Alert>{error}</Alert>}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label={m.common.name} name="name" autoComplete="name" required />
        <Field label={m.common.email} name="email" type="email" autoComplete="email" required />
        <Field
          label={m.common.password}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={features.minPasswordLength}
          hint={format(m.signUp.passwordHint, { min: features.minPasswordLength })}
          required
        />
        <Field
          label={m.signUp.confirmPassword}
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
        <SubmitButton pending={pending}>{m.signUp.submit}</SubmitButton>
      </form>
      <p className="text-sm text-center">
        {m.signUp.haveAccount}{" "}
        <Link href={routes.signIn} className="link link-primary">
          {m.signUp.signInLink}
        </Link>
      </p>
    </AuthCard>
  );
}

/** Registration form. Reads `?invite=<token>` and sends it to the server gate. */
export function SignUpForm() {
  return (
    <Suspense fallback={<span className="loading loading-spinner mx-auto" />}>
      <SignUpFormInner />
    </Suspense>
  );
}
