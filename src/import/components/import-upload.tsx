"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callApi, type ApiResult } from "@/shared/api-client";
import { formatCents } from "@/shared/money";
import type { ImportPreview } from "../contract";

type Props = {
  /** The accounts the user may import into (passed by the app). */
  accounts: { id: string; name: string }[];
  /** Preselected account. */
  accountId?: string;
  /** Endpoint for imports. Default: /api/imports */
  action?: string;
};

type PreviewResponse = { preview: ImportPreview; openingBalance: { willSet: boolean; cents: number | null } };
type ConfirmResponse = {
  import: { newCount: number; mergedCount: number };
  transfers?: { linked: number; proposed: number } | null;
  rules?: { applied: number } | null;
};
type Failure = { reason: string; line?: number };

const ERROR_KEYS = ["invalid-input", "not-found", "too-large", "empty", "unknown-format", "invalid-row", "unsupported-currency", "wrong-bank", "preview-outdated"];

function failureOf(result: Extract<ApiResult<unknown>, { ok: false }>): Failure {
  const reason = result.error && ERROR_KEYS.includes(result.error) ? result.error : result.status === 404 ? "not-found" : "failed";
  const line = (result.body as { line?: unknown } | undefined)?.line;
  return { reason, line: typeof line === "number" ? line : undefined };
}

/** Upload a bank export into an account: preview first, then confirm. */
export function ImportUpload({ accounts, accountId, action = "/api/imports" }: Props) {
  const t = useTranslations("import.upload");
  const tErrors = useTranslations("import.errors");
  const tKinds = useTranslations("import.kinds");
  const tBanks = useTranslations("import.banks");
  const format = useFormatter();
  const router = useRouter();
  const [account, setAccount] = useState(accountId ?? accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Lines whose merge proposal the user declined (imported as new bookings instead).
  const [declined, setDeclined] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<{
    count: number;
    merged: number;
    transfers: { linked: number; proposed: number } | null;
    rules: { applied: number } | null;
  } | null>(null);
  const [pending, setPending] = useState(false);

  const date = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });

  function reset() {
    setPreview(null);
    setFailure(null);
  }

  async function send<T>(path: string, merges?: { line: number; transactionId: string }[]): Promise<T | null> {
    if (!account || !file) {
      setFailure({ reason: "invalid-input" });
      return null;
    }
    const body = new FormData();
    body.set("accountId", account);
    body.set("file", file);
    if (merges) body.set("merges", JSON.stringify(merges));
    setPending(true);
    setFailure(null);
    const result = await callApi<T>(path, { form: body });
    setPending(false);
    if (!result.ok) {
      const failed = failureOf(result);
      setFailure(failed);
      // The proposals changed: show the preview button again.
      if (failed.reason === "preview-outdated") setPreview(null);
      return null;
    }
    return result.data;
  }

  async function onPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(null);
    setPreview(null);
    setDeclined(new Set());
    const response = await send<PreviewResponse>(`${action}/preview`);
    if (response) setPreview(response);
  }

  async function onConfirm() {
    const merges = (preview?.preview.rows ?? []).flatMap((row) =>
      row.merge && !declined.has(row.line) ? [{ line: row.line, transactionId: row.merge.transactionId }] : [],
    );
    const body = await send<ConfirmResponse>(action, merges);
    if (!body) return;
    setDone({ count: body.import.newCount, merged: body.import.mergedCount, transfers: body.transfers ?? null, rules: body.rules ?? null });
    setPreview(null);
    setFile(null);
    (document.getElementById("import-file") as HTMLInputElement | null)?.form?.reset();
    router.refresh();
  }

  if (accounts.length === 0) return <p className="opacity-70">{t("noAccounts")}</p>;

  const summary = preview?.preview;
  const accepted = summary ? summary.counts.merge - declined.size : 0;

  function toggle(line: number) {
    setDeclined((current) => {
      const next = new Set(current);
      if (!next.delete(line)) next.add(line);
      return next;
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onPreview} className="flex flex-col gap-3">
        <fieldset className="fieldset">
          <legend className="fieldset-legend">{t("account")}</legend>
          <select
            className="select w-full"
            name="accountId"
            value={account}
            onChange={(event) => {
              setAccount(event.target.value);
              reset();
            }}
          >
            {accounts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </fieldset>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">{t("file")}</legend>
          <input
            id="import-file"
            type="file"
            name="file"
            accept=".csv,text/csv"
            className="file-input w-full"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              reset();
            }}
          />
          <p className="label whitespace-normal">{t("fileHint")}</p>
        </fieldset>
        {failure && (
          <div role="alert" className="alert alert-error">
            {failure.reason === "failed" ? tErrors("failed") : tErrors(failure.reason as "invalid-row", { line: failure.line ?? "?" })}
          </div>
        )}
        {done !== null && (
          <div role="status" className="alert alert-success">
            {t("done", { count: done.count, merged: done.merged })}
            {done.rules && done.rules.applied > 0 && <> {t("rulesApplied", done.rules)}</>}
            {done.transfers && done.transfers.linked + done.transfers.proposed > 0 && (
              <> {t("transfersFound", done.transfers)}</>
            )}
          </div>
        )}
        {!summary && (
          <button type="submit" className="btn btn-primary self-start" disabled={pending || !file}>
            {pending && <span className="loading loading-spinner loading-sm" />}
            {t("preview")}
          </button>
        )}
      </form>

      {summary && preview && (
        <section className="flex flex-col gap-3" aria-label={t("preview")}>
          <p className="font-semibold">
            {t("summary", {
              rows: summary.counts.rows,
              new: summary.counts.new + declined.size,
              duplicate: summary.counts.duplicate,
              merge: accepted,
            })}
          </p>
          {summary.periodFrom && summary.periodTo && (
            <p className="text-sm opacity-70">
              {t("period", { bank: tBanks(summary.bank), from: date(summary.periodFrom), to: date(summary.periodTo) })}
            </p>
          )}
          {summary.counts.skipped > 0 && <p className="text-sm opacity-70">{t("skipped", { count: summary.counts.skipped })}</p>}
          {preview.openingBalance.willSet && preview.openingBalance.cents !== null && summary.closingBalanceCents !== null && (
            <div role="note" className="alert alert-info">
              {t("openingBalance", {
                opening: formatCents(preview.openingBalance.cents),
                closing: formatCents(summary.closingBalanceCents),
              })}
            </div>
          )}
          {summary.counts.merge > 0 && (
            <div role="note" className="alert alert-info">
              {t("mergeNote", { count: summary.counts.merge })}
            </div>
          )}
          {summary.counts.new + summary.counts.merge === 0 && <div className="alert">{t("nothingNew")}</div>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={pending}>
              {pending && <span className="loading loading-spinner loading-sm" />}
              {t("confirm")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={reset} disabled={pending}>
              {t("cancel")}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>{t("date")}</th>
                  <th>{t("text")}</th>
                  <th>{t("kind")}</th>
                  <th className="text-right">{t("amount")}</th>
                  <th>{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row) => (
                  <tr key={row.line} className={row.status === "duplicate" ? "opacity-50" : undefined}>
                    <td className="whitespace-nowrap">{date(row.date)}</td>
                    <td className="max-w-xs">
                      <div className="truncate">{row.counterparty}</div>
                      <div className="truncate text-xs opacity-70">{row.reference}</div>
                      {row.merge && (
                        <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-info">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-xs checkbox-info"
                            checked={!declined.has(row.line)}
                            onChange={() => toggle(row.line)}
                            aria-label={t("merge")}
                          />
                          <span className="truncate">
                            {t("mergeWith", {
                              date: date(row.merge.date),
                              text: row.merge.counterparty ?? row.merge.reference ?? "none",
                            })}
                          </span>
                        </label>
                      )}
                    </td>
                    <td>{tKinds(row.kind)}</td>
                    <td className={`whitespace-nowrap text-right ${row.amountCents < 0 ? "" : "text-success"}`}>
                      {formatCents(row.amountCents)} €
                    </td>
                    <td>
                      {row.merge && !declined.has(row.line) ? (
                        <span className="badge badge-soft badge-info badge-sm whitespace-nowrap">{t("merge")}</span>
                      ) : (
                        <span className={`badge badge-sm ${row.status === "duplicate" ? "badge-ghost" : "badge-soft badge-primary"}`}>
                          {t(row.status === "duplicate" ? "duplicate" : "new")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
