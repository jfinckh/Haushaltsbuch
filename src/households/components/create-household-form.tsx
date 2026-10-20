"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createHouseholdSchema } from "../validation";

type Props = {
  /** Endpoint that creates the household. Default: /api/households */
  action?: string;
  /** Where to go after creating it. Default: / */
  redirectTo?: string;
};

export function CreateHouseholdForm({ action = "/api/households", redirectTo = "/" }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = createHouseholdSchema.safeParse({ name: form.get("name") });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid input");

    setPending(true);
    setError(null);
    const response = await fetch(action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    setPending(false);
    if (!response.ok && response.status !== 409) return setError("Could not create the household. Please try again.");
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="card bg-base-100 w-full max-w-sm shadow-md">
      <div className="card-body gap-3">
        <h1 className="card-title text-2xl">Create your household</h1>
        <p className="opacity-70">You can invite your partner afterwards.</p>
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="household-name">Name</label>
          <input id="household-name" name="name" type="text" placeholder="e.g. Mustermann" className="input w-full" required maxLength={100} />
          {error && <p className="label text-error">{error}</p>}
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending && <span className="loading loading-spinner loading-sm" />}
          Create household
        </button>
      </div>
    </form>
  );
}
