"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Posts an action to the transfers API and refreshes the page; tracks pending and the error. */
export function useTransferAction(endpoint = "/api/transfers") {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"failed" | "taken" | null>(null);

  async function run(path: string, body: unknown) {
    setPending(true);
    setError(null);
    const response = await fetch(`${endpoint}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      setError(response?.status === 409 ? "taken" : "failed");
      return false;
    }
    router.refresh();
    return true;
  }

  return { run, pending, error };
}
