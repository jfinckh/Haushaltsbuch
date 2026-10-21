"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { authClient } from "../client";

type Props = {
  /** Text shown in the native share sheet. Default: none, only the link. */
  shareText?: string;
};

type State =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ready"; url: string; expiresAt: Date; copied: boolean }
  | { status: "error" };

/** Creates a single-use invite link and shares it (native share sheet) or shows it to copy. */
export function InviteShareButton({ shareText }: Props) {
  const t = useTranslations("auth.invite");
  const format = useFormatter();
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
        {t("button")}
      </button>
      {state.status === "error" && (
        <div role="alert" className="alert alert-error alert-soft">
          {t("createFailed")}
        </div>
      )}
      {state.status === "ready" && (
        <div className="flex flex-col gap-2">
          <div className="join w-full">
            <input className="input join-item w-full" value={state.url} readOnly aria-label={t("linkLabel")} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn join-item" onClick={() => copy(state.url, state.expiresAt)}>
              {state.copied ? t("copied") : t("copy")}
            </button>
          </div>
          <p className="text-sm opacity-70">
            {t("validUntil", { date: format.dateTime(state.expiresAt, { dateStyle: "medium" }) })}
          </p>
        </div>
      )}
    </div>
  );
}
