"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { authClient } from "../client";

type Props = {
  /** Where to go after signing out, e.g. the zero-trust provider's logout page. Default: /sign-in */
  redirectTo?: string;
  className?: string;
};

export function SignOutButton({ redirectTo = "/sign-in", className = "btn btn-ghost" }: Props) {
  const t = useTranslations("auth");
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    await authClient.signOut();
    // A full page load: the logout page of the zero-trust provider is not part of the app.
    window.location.assign(redirectTo);
  }

  return (
    <button type="button" className={className} onClick={onClick} disabled={pending}>
      {t("signOut")}
    </button>
  );
}
