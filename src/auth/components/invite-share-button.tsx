"use client";

import { useState } from "react";
import { authClient } from "../client";

type Props = {
  /** Text shown in the native share sheet. */
  shareText?: string;
};

type State =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ready"; url: string; expiresAt: Date; copied: boolean }
  | { status: "error" };

/** Creates a single-use invite link and shares it (native share sheet) or shows it to copy. */
export function InviteShareButton({ shareText = "Join me:" }: Props) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function createAndShare() {
    setState({ status: "pending" });
    const { data, error } = await authClient.invite.create();
    if (error || !data) return setState({ status: "error" });
    const expiresAt = new Date(data.expiresAt);
    setState({ status: "ready", url: data.url, expiresAt, copied: false });

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text: shareText, url: data.url });
      } catch {
        // Share sheet dismissed: the link stays visible to copy.
      }
    }
  }

  async function copy(url: string, expiresAt: Date) {
    await navigator.clipboard.writeText(url);
    setState({ status: "ready", url, expiresAt, copied: true });
  }

  return (
    <div className="flex flex-col gap-3">
      <button type="button" className="btn btn-primary" onClick={createAndShare} disabled={state.status === "pending"}>
        {state.status === "pending" && <span className="loading loading-spinner loading-sm" />}
        Invite someone
      </button>
      {state.status === "error" && (
        <div role="alert" className="alert alert-error alert-soft">
          Could not create an invite link. Please try again.
        </div>
      )}
      {state.status === "ready" && (
        <div className="flex flex-col gap-2">
          <div className="join w-full">
            <input className="input join-item w-full" value={state.url} readOnly aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn join-item" onClick={() => copy(state.url, state.expiresAt)}>
              {state.copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-sm opacity-70">
            Works once, valid until {state.expiresAt.toLocaleDateString("en-GB")}.
          </p>
        </div>
      )}
    </div>
  );
}
