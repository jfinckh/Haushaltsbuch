"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { renameHouseholdSchema } from "../validation";

type Props = {
  name: string;
  /** Endpoint that renames the household. Default: /api/households */
  action?: string;
};

/** The household name with an inline edit. Any member may rename the household. */
export function HouseholdNameEditor({ name, action = "/api/households" }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = renameHouseholdSchema.safeParse({ name: form.get("name") });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid input");

    setPending(true);
    setError(null);
    const response = await fetch(action, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    setPending(false);
    if (!response.ok) return setError("Could not rename the household. Please try again.");
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-lg font-semibold">{name}</p>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditing(true)}>
          Rename
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="join w-full">
        <input
          name="name"
          type="text"
          aria-label="Household name"
          defaultValue={name}
          className="input join-item w-full"
          required
          maxLength={100}
          autoFocus
        />
        <button type="submit" className="btn btn-primary join-item" disabled={pending}>
          {pending && <span className="loading loading-spinner loading-sm" />}
          Save
        </button>
        <button
          type="button"
          className="btn join-item"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
      {error && <p className="label text-error mt-1">{error}</p>}
    </form>
  );
}
