"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { callApi } from "@/shared/api-client";
import type { ImportView } from "../contract";

type Props = {
  imports: ImportView[];
  /** Account names by id (passed by the app). */
  accountNames: Record<string, string>;
  /** Endpoint for imports. Default: /api/imports */
  action?: string;
};

/** Past imports, newest first, each with an undo button. */
export function ImportList({ imports, accountNames, action = "/api/imports" }: Props) {
  const t = useTranslations("import.list");
  if (imports.length === 0) return <p className="text-sm text-base-content/60">{t("empty")}</p>;
  return (
    <ul className="flex flex-col divide-y divide-base-300">
      {imports.map((item) => (
        <ImportRow key={item.id} item={item} accountName={accountNames[item.accountId] ?? ""} action={action} />
      ))}
    </ul>
  );
}

function ImportRow({ item, accountName, action }: { item: ImportView; accountName: string; action: string }) {
  const t = useTranslations("import.list");
  const tBanks = useTranslations("import.banks");
  const format = useFormatter();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });

  async function undo() {
    setPending(true);
    setFailed(false);
    const result = await callApi(`${action}/${item.id}`, { method: "DELETE" });
    setPending(false);
    if (!result.ok && result.status !== 404) return setFailed(true);
    dialog.current?.close();
    router.refresh();
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 py-3">
      <div className="min-w-0">
        <div className="font-medium">
          {accountName} · {tBanks(item.bank)}
        </div>
        <div className="truncate text-sm text-base-content/60">
          {format.dateTime(new Date(item.createdAt), { dateStyle: "medium", timeStyle: "short" })} · {item.fileName}
          {!item.createdByMe && ` · ${t("byOther")}`}
        </div>
        <div className="text-sm text-base-content/80">
          {item.periodFrom && item.periodTo && `${day(item.periodFrom)} – ${day(item.periodTo)} · `}
          {t("counts", { new: item.newCount, duplicate: item.duplicateCount, merged: item.mergedCount })}
          {item.remainingCount + item.mergedRemainingCount !== item.newCount + item.mergedCount &&
            ` · ${t("remaining", { count: item.remainingCount + item.mergedRemainingCount })}`}
        </div>
      </div>
      <button type="button" className="btn btn-ghost btn-sm font-normal text-error" onClick={() => dialog.current?.showModal()}>
        {t("undo")}
      </button>
      <dialog ref={dialog} className="modal">
        <div className="modal-box">
          <h3 className="text-lg font-bold">{t("undoTitle")}</h3>
          <p className="py-4">{t("undoText", { count: item.remainingCount, merged: item.mergedRemainingCount })}</p>
          {failed && <p className="text-error">{t("undoFailed")}</p>}
          <div className="modal-action">
            <form method="dialog">
              <button className="btn">{t("cancel")}</button>
            </form>
            <button type="button" className="btn btn-error" onClick={undo} disabled={pending}>
              {pending && <span className="loading loading-spinner loading-sm" />}
              {t("undo")}
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>{t("close")}</button>
        </form>
      </dialog>
    </li>
  );
}
