"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Props = {
  id: string;
  archived: boolean;
  shared: boolean;
  /** Endpoint for accounts. Default: /api/accounts */
  action?: string;
  /** Where to go after deleting. Default: / */
  redirectTo?: string;
};

/** Archive or unarchive an account, or delete it after a confirmation. */
export function AccountActions({ id, archived, shared, action = "/api/accounts", redirectTo = "/" }: Props) {
  const t = useTranslations("accounts.actions");
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<"changeFailed" | "deleteFailed" | null>(null);
  const [pending, setPending] = useState(false);

  async function send(init: RequestInit, failure: "changeFailed" | "deleteFailed") {
    setPending(true);
    setError(null);
    const response = await fetch(`${action}/${id}`, init);
    setPending(false);
    if (!response.ok && response.status !== 404) {
      setError(failure);
      return false;
    }
    return true;
  }

  async function toggleArchived() {
    const ok = await send(
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: !archived }) },
      "changeFailed",
    );
    if (ok) router.refresh();
  }

  async function remove() {
    const ok = await send({ method: "DELETE" }, "deleteFailed");
    if (!ok) return;
    dialog.current?.close();
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-sm" onClick={toggleArchived} disabled={pending}>
          {archived ? t("unarchive") : t("archive")}
        </button>
        <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => dialog.current?.showModal()}>
          {t("delete")}
        </button>
      </div>
      {error && <p className="text-error text-sm">{t(error)}</p>}
      <dialog ref={dialog} className="modal">
        <div className="modal-box">
          <h3 className="text-lg font-bold">{t("deleteTitle")}</h3>
          <p className="py-4">
            {shared ? t("deleteShared") : t("deletePrivate")}
          </p>
          {error && <p className="text-error">{t(error)}</p>}
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
