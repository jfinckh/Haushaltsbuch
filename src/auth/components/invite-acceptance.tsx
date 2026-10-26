"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authClient } from "../client";

type Props = {
  token: string;
  /** Sign-in page; it should lead back to this page so the user can accept. */
  signInHref: string;
  /** Where the user continues to after accepting, declining or for their own invite. */
  continueHref?: string;
  /** Runs after the invite was accepted, e.g. the app's server action that acts on it. */
  onAccepted?: () => Promise<void>;
};

type State =
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "valid"; inviterName: string; signedIn: boolean; own: boolean }
  | { status: "accepted"; inviterName: string };

const openInvite = (token: string) => authClient.invite.open({ token });

/**
 * Landing view for an invite link. Opening it only shows who invites; a signed-in user joins with
 * "Beitreten", so a link alone never moves anyone into a household.
 */
export function InviteAcceptance({ token, signInHref, continueHref = "/", onAccepted }: Props) {
  const t = useTranslations("auth.inviteAcceptance");
  const [state, setState] = useState<State>({ status: "loading" });
  const [pending, setPending] = useState(false);
  // Effects can run twice (React Strict Mode); both runs share one request.
  const request = useRef<{ token: string; promise: ReturnType<typeof openInvite> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (request.current?.token !== token) request.current = { token, promise: openInvite(token) };
    request.current.promise.then(({ data }) => {
      if (cancelled) return;
      if (!data?.valid) setState({ status: "invalid" });
      else setState({ status: "valid", inviterName: data.inviterName, signedIn: data.signedIn, own: data.own });
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept(inviterName: string) {
    setPending(true);
    const { data } = await authClient.invite.accept({ token });
    // The invite is recorded either way; if acting on it fails, the start page offers it again.
    if (data?.applied) await onAccepted?.().catch(() => undefined);
    setPending(false);
    setState(data?.applied ? { status: "accepted", inviterName } : { status: "invalid" });
  }

  return (
    <div className="card bg-base-100 w-full max-w-sm shadow-md">
      <div className="card-body gap-4">
        {state.status === "loading" && <span className="loading loading-spinner mx-auto" />}
        {state.status === "invalid" && (
          <>
            <h1 className="card-title text-2xl">{t("invalidTitle")}</h1>
            <p>{t("invalidText")}</p>
            <div className="card-actions">
              <Link href={continueHref} className="btn btn-primary">{t("continue")}</Link>
            </div>
          </>
        )}
        {state.status === "accepted" && (
          <>
            <h1 className="card-title text-2xl">{t("acceptedTitle")}</h1>
            <p>{t("acceptedText", { name: state.inviterName })}</p>
            <div className="card-actions">
              <Link href={continueHref} className="btn btn-primary">{t("continue")}</Link>
            </div>
          </>
        )}
        {state.status === "valid" && state.own && (
          <>
            <h1 className="card-title text-2xl">{t("ownTitle")}</h1>
            <p>{t("ownText")}</p>
            <div className="card-actions">
              <Link href={continueHref} className="btn btn-primary">{t("continue")}</Link>
            </div>
          </>
        )}
        {state.status === "valid" && !state.own && state.signedIn && (
          <>
            <h1 className="card-title text-2xl">{t("invitedTitle", { name: state.inviterName })}</h1>
            <p>{t("joinText")}</p>
            <div className="card-actions">
              <button type="button" className="btn btn-primary" disabled={pending} onClick={() => accept(state.inviterName)}>
                {pending && <span className="loading loading-spinner loading-sm" />}
                {t("join")}
              </button>
              <Link href={continueHref} className="btn btn-ghost">{t("notNow")}</Link>
            </div>
          </>
        )}
        {state.status === "valid" && !state.signedIn && (
          <>
            <h1 className="card-title text-2xl">{t("invitedTitle", { name: state.inviterName })}</h1>
            <p>{t("invitedText")}</p>
            <div className="card-actions">
              <Link href={signInHref} className="btn btn-primary">{t("signIn")}</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
