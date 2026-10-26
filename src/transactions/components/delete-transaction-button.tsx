"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { callApi } from "@/shared/api-client";

type Props = {
  id: string;
  /** Where to go after deleting, e.g. the account page. */
  redirectTo: string;
  /** Endpoint for bookings. Default: /api/transactions */
  action?: string;
};

/** Deletes a booking after a confirmation. */
export function DeleteTransactionButton({ id, redirectTo, action = "/api/transactions" }: Props) {
  const t = useTranslations("transactions.actions");
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    setFailed(false);
    const result = await callApi(`${action}/${id}`, { method: "DELETE" });
    setPending(false);
    if (!result.ok && result.status !== 404) return setFailed(true);
    dialog.current?.close();
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="flex justify-end">
      <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => dialog.current?.showModal()}>
        {t("delete")}
      </button>
      <dialog ref={dialog} className="modal">
        <div className="modal-box">
          <h3 className="text-lg font-bold">{t("deleteTitle")}</h3>
          <p className="py-4">{t("deleteText")}</p>
          {failed && <p className="text-error">{t("deleteFailed")}</p>}
          <div className="modal-action">
            <form method="dialog">
              <button className="btn">{t("cancel")}</button>
            </form>
            <button type="button" className="btn btn-error" onClick={remove} disabled={pending}>
              {pending && <span className="loading loading-spinner loading-sm" />}
              {t("delete")}
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>{t("close")}</button>
        </form>
      </dialog>
    </div>
  );
}
