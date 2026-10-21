"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authClient } from "../client";

type Props = {
  token: string;
  signInHref: string;
  signUpHref: string;
  /** Where a user who is already signed in continues to. */
  continueHref?: string;
};

type State =
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "valid"; inviterName: string; applied: boolean; signedIn: boolean };

const openInvite = (token: string) => authClient.invite.open({ token });

/** Landing view for an invite link: checks it and remembers it for the next sign-up or sign-in. */
export function InviteAcceptance({ token, signInHref, signUpHref, continueHref = "/" }: Props) {
  const t = useTranslations("auth.inviteAcceptance");
  const [state, setState] = useState<State>({ status: "loading" });
  // Opening an invite applies it, so it must run once per token. Effects can run twice
  // (React Strict Mode); both runs share the same request.
  const request = useRef<{ token: string; promise: ReturnType<typeof openInvite> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (request.current?.token !== token) request.current = { token, promise: openInvite(token) };
    request.current.promise.then(({ data }) => {
      if (cancelled) return;
      if (!data?.valid) setState({ status: "invalid" });
      else setState({ status: "valid", inviterName: data.inviterName, applied: data.applied, signedIn: data.signedIn });
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="card bg-base-100 w-full max-w-sm shadow-md">
      <div className="card-body gap-4">
        {state.status === "loading" && <span className="loading loading-spinner mx-auto" />}
        {state.status === "invalid" && (
          <>
            <h1 className="card-title text-2xl">{t("invalidTitle")}</h1>
            <p>{t("invalidText")}</p>
            <div className="card-actions">
              <Link href={signUpHref} className="btn btn-primary">{t("signUp")}</Link>
              <Link href={signInHref} className="btn btn-ghost">{t("signIn")}</Link>
            </div>
          </>
        )}
        {state.status === "valid" && state.applied && (
          <>
            <h1 className="card-title text-2xl">{t("acceptedTitle")}</h1>
            <p>{t("acceptedText", { name: state.inviterName })}</p>
            <div className="card-actions">
              <Link href={continueHref} className="btn btn-primary">{t("continue")}</Link>
            </div>
          </>
        )}
        {state.status === "valid" && !state.applied && state.signedIn && (
          <>
            <h1 className="card-title text-2xl">{t("ownTitle")}</h1>
            <p>{t("ownText")}</p>
            <div className="card-actions">
              <Link href={continueHref} className="btn btn-primary">{t("continue")}</Link>
            </div>
          </>
        )}
        {state.status === "valid" && !state.applied && !state.signedIn && (
          <>
            <h1 className="card-title text-2xl">{t("invitedTitle", { name: state.inviterName })}</h1>
            <p>{t("invitedText")}</p>
            <div className="card-actions">
              <Link href={signUpHref} className="btn btn-primary">{t("signUp")}</Link>
              <Link href={signInHref} className="btn btn-ghost">{t("signIn")}</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
