"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { callApi } from "@/shared/api-client";

type Props = {
  /** Whether the user is the only member, so leaving deletes the household. */
  lastMember: boolean;
  /** What else happens when the user leaves, from the app (e.g. what happens to other parts' data). */
  note?: string;
  /** Endpoint for the caller's membership. Default: /api/households/membership */
  action?: string;
  /** Where to go after leaving. Default: /household/new */
  redirectTo?: string;
};

/** Leaves the household after a confirmation. The last member to leave deletes it. */
export function LeaveHouseholdButton({
  lastMember,
  note,
  action = "/api/households/membership",
  redirectTo = "/household/new",
}: Props) {
  const t = useTranslations("households.leave");
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  async function leave() {
    setPending(true);
    setFailed(false);
    const result = await callApi(action, { method: "DELETE" });
    setPending(false);
    if (!result.ok && result.status !== 404) return setFailed(true);
    dialog.current?.close();
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => dialog.current?.showModal()}>
        {t("button")}
      </button>
      <dialog ref={dialog} className="modal">
        <div className="modal-box">
          <h3 className="text-lg font-bold">{t("title")}</h3>
          <p className="py-4">
            {lastMember ? t("lastMember") : t("otherMembers")}
          </p>
          {note && <p className="pb-4">{note}</p>}
          {failed && <p className="text-error">{t("failed")}</p>}
          <div className="modal-action">
            <form method="dialog">
              <button className="btn">{t("cancel")}</button>
            </form>
            <button type="button" className="btn btn-error" onClick={leave} disabled={pending}>
              {pending && <span className="loading loading-spinner loading-sm" />}
              {t("confirm")}
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>{t("close")}</button>
        </form>
      </dialog>
    </>
  );
}
