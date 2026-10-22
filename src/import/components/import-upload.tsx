"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatCents } from "@/shared/money";
import type { ImportPreview } from "../create-imports";

type Props = {
  /** The accounts the user may import into (passed by the app). */
  accounts: { id: string; name: string }[];
  /** Preselected account. */
  accountId?: string;
  /** Endpoint for imports. Default: /api/imports */
  action?: string;
};

type PreviewResponse = { preview: ImportPreview; openingBalance: { willSet: boolean; cents: number | null } };
type Failure = { reason: string; line?: number };

const ERROR_KEYS = ["invalid-input", "not-found", "too-large", "empty", "unknown-format", "invalid-row", "unsupported-currency", "wrong-bank"];

async function failureOf(response: Response): Promise<Failure> {
  const body = (await response.json().catch(() => null)) as { error?: string; line?: number } | null;
  const reason = body?.error && ERROR_KEYS.includes(body.error) ? body.error : response.status === 404 ? "not-found" : "failed";
  return { reason, line: body?.line };
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
  const [done, setDone] = useState<{
    count: number;
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

  async function send(path: string): Promise<Response | null> {
    if (!account || !file) {
      setFailure({ reason: "invalid-input" });
      return null;
    }
    const body = new FormData();
    body.set("accountId", account);
    body.set("file", file);
    setPending(true);
    setFailure(null);
    try {
      const response = await fetch(path, { method: "POST", body });
      if (!response.ok) {
        setFailure(await failureOf(response));
        return null;
      }
      return response;
    } catch {
      setFailure({ reason: "failed" });
      return null;
    } finally {
      setPending(false);
    }
  }

  async function onPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(null);
    setPreview(null);
    const response = await send(`${action}/preview`);
    if (response) setPreview((await response.json()) as PreviewResponse);
  }

  async function onConfirm() {
    const response = await send(action);
    if (!response) return;
    const body = (await response.json()) as {
      import: { newCount: number };
      transfers?: { linked: number; proposed: number } | null;
      rules?: { applied: number } | null;
    };
    setDone({ count: body.import.newCount, transfers: body.transfers ?? null, rules: body.rules ?? null });
    setPreview(null);
    setFile(null);
    (document.getElementById("import-file") as HTMLInputElement | null)?.form?.reset();
    router.refresh();
  }

  if (accounts.length === 0) return <p className="opacity-70">{t("noAccounts")}</p>;

  const summary = preview?.preview;
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
            {t("done", { count: done.count })}
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
            {t("summary", { rows: summary.counts.rows, new: summary.counts.new, duplicate: summary.counts.duplicate })}
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
          {summary.counts.new === 0 && <div className="alert">{t("nothingNew")}</div>}
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
                    </td>
                    <td>{tKinds(row.kind)}</td>
                    <td className={`whitespace-nowrap text-right ${row.amountCents < 0 ? "" : "text-success"}`}>
                      {formatCents(row.amountCents)} €
                    </td>
                    <td>
                      <span className={`badge badge-sm ${row.status === "new" ? "badge-primary" : "badge-ghost"}`}>
                        {t(row.status)}
                      </span>
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
