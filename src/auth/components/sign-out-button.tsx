"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../client";

type Props = {
  /** Where to go after signing out. Default: /sign-in */
  redirectTo?: string;
  className?: string;
};

export function SignOutButton({ redirectTo = "/sign-in", className = "btn btn-ghost" }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    await authClient.signOut();
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <button type="button" className={className} onClick={onClick} disabled={pending}>
      Sign out
    </button>
  );
}
