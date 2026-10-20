"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "../client";
import { signUpSchema } from "../validation";
import { fieldErrors } from "./field-errors";

type Props = {
  /** Where to go after signing up. Default: / */
  redirectTo?: string;
  /** Link to the sign-in page. Omit to hide the link. */
  signInHref?: string;
};

export function SignUpForm({ redirectTo = "/", signInHref }: Props) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = signUpSchema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));

    setPending(true);
    setErrors({});
    const { error } = await authClient.signUp.email(parsed.data);
    setPending(false);
    if (error) return setErrors({ form: error.message ?? "Sign-up failed." });
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="card bg-base-100 w-full max-w-sm shadow-md">
      <div className="card-body gap-3">
        <h1 className="card-title text-2xl">Create account</h1>
        {errors.form && (
          <div role="alert" className="alert alert-error alert-soft">
            {errors.form}
          </div>
        )}
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="sign-up-name">Name</label>
          <input id="sign-up-name" name="name" type="text" autoComplete="name" className="input w-full" required />
          {errors.name && <p className="label text-error">{errors.name}</p>}
          <label className="fieldset-legend" htmlFor="sign-up-email">Email</label>
          <input id="sign-up-email" name="email" type="email" autoComplete="email" className="input w-full" required />
          {errors.email && <p className="label text-error">{errors.email}</p>}
          <label className="fieldset-legend" htmlFor="sign-up-password">Password</label>
          <input id="sign-up-password" name="password" type="password" autoComplete="new-password" className="input w-full" required minLength={8} />
          {errors.password ? (
            <p className="label text-error">{errors.password}</p>
          ) : (
            <p className="label">At least 8 characters.</p>
          )}
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending && <span className="loading loading-spinner loading-sm" />}
          Sign up
        </button>
        {signInHref && (
          <p className="text-sm">
            Already have an account?{" "}
            <Link href={signInHref} className="link link-primary">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </form>
  );
}
