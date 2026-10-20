"use client";

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
            <h1 className="card-title text-2xl">Invite link not valid</h1>
            <p>This link has expired or was already used. Ask for a new one, or sign up without an invite.</p>
            <div className="card-actions">
              <Link href={signUpHref} className="btn btn-primary">Sign up</Link>
              <Link href={signInHref} className="btn btn-ghost">Sign in</Link>
            </div>
          </>
        )}
        {state.status === "valid" && state.applied && (
          <>
            <h1 className="card-title text-2xl">Invite accepted</h1>
            <p>You were invited by {state.inviterName}.</p>
            <div className="card-actions">
              <Link href={continueHref} className="btn btn-primary">Continue</Link>
            </div>
          </>
        )}
        {state.status === "valid" && !state.applied && state.signedIn && (
          <>
            <h1 className="card-title text-2xl">This is your own invite</h1>
            <p>You can&apos;t accept your own invite link. Share it with the person you want to invite.</p>
            <div className="card-actions">
              <Link href={continueHref} className="btn btn-primary">Continue</Link>
            </div>
          </>
        )}
        {state.status === "valid" && !state.applied && !state.signedIn && (
          <>
            <h1 className="card-title text-2xl">{state.inviterName} invited you</h1>
            <p>Create an account, or sign in if you already have one.</p>
            <div className="card-actions">
              <Link href={signUpHref} className="btn btn-primary">Sign up</Link>
              <Link href={signInHref} className="btn btn-ghost">Sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
