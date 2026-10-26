"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "@/shared/api-client";

/** Posts an action to the transfers API and refreshes the page; tracks pending and the error. */
export function useTransferAction(endpoint = "/api/transfers") {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"failed" | "taken" | null>(null);

  async function run(path: string, body: unknown) {
    setPending(true);
    setError(null);
    const result = await callApi(`${endpoint}/${path}`, { json: body });
    setPending(false);
    if (!result.ok) {
      setError(result.status === 409 ? "taken" : "failed");
      return false;
    }
    router.refresh();
    return true;
  }

  return { run, pending, error };
}
