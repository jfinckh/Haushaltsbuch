"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { TransferKind, TransferStatus } from "../types";
import { useTransferAction } from "./use-transfer-action";
import { useTransferTexts } from "./use-transfer-texts";

type Props = {
  status: TransferStatus;
  /** The accounts the viewer may see (for names and the "account in the app" target). */
  accounts: { id: string; name: string }[];
  /** Names of the household members (user id → name). */
  memberNames: Record<string, string>;
  /** Endpoint of the transfers API. Default: /api/transfers */
  endpoint?: string;
  /**
   * Offer "Künftig immer so" when marking a transfer from or to an external own account: the action
   * then carries `rule: { field, pattern }`, and the app creates a rule from the booking.
   */
  offerRule?: boolean;
};

const KINDS: TransferKind[] = ["transfer", "saving", "expense", "income"];

/** The transfer box on the booking page: link, proposals, open state and the corrections. */
export function TransferPanel({ status, accounts, memberNames, endpoint, offerRule = false }: Props) {
  const t = useTranslations("transfers");
  const names = { accounts: Object.fromEntries(accounts.map((a) => [a.id, a.name])), members: memberNames };
  const texts = useTransferTexts(names);
  const { run, pending, error } = useTransferAction(endpoint);
  const { booking, link, proposals, decision } = status;
  const [candidate, setCandidate] = useState(status.candidates[0]?.id ?? "");
  const [kind, setKind] = useState<TransferKind>(booking.kind);
  const targets = accounts.filter((a) => a.id !== booking.accountId);
  const [target, setTarget] = useState("external");
  const ruleField = booking.counterparty ? "counterparty" : booking.reference ? "reference" : null;
  const [learn, setLearn] = useState(false);
  const [rulePattern, setRulePattern] = useState((ruleField && booking[ruleField]) ?? "");
  const canLearn = offerRule && target === "external" && ruleField !== null;

  const act = (body: unknown) => run(booking.id, body);

  return (
    <section className="flex flex-col gap-3" aria-label={t("title")}>
      <h2 className="font-semibold">{t("title")}</h2>

      {link && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-box bg-base-200 p-3">
          <div className="min-w-0">
            <p className="font-medium">{texts.partnerLabel(booking, link.partner)}</p>
            <p className="text-sm opacity-70">
              {link.partner.visible && `${texts.bookingLine(link.partner.booking)} · `}
              {t(link.manual ? "status.manual" : "status.automatic")}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act({ action: "unlink" })}>
            {t("actions.unlink")}
          </button>
        </div>
      )}

      {status.open && (
        <div role="status" className={`alert alert-soft ${status.overdue ? "alert-warning" : "alert-info"}`}>
          <span>{t(status.overdue ? "status.overdue" : "status.open")}</span>
        </div>
      )}

      {decision?.type === "no-partner" && (
        <p className="text-sm">
          {decision.target === "external"
            ? t("status.external")
            : t("status.toAccount", { account: (decision.accountId && names.accounts[decision.accountId]) || t("status.anotherAccount") })}
        </p>
      )}
      {status.ruleTarget === "external" && !link && !decision && <p className="text-sm">{t("status.externalByRule")}</p>}
      {decision?.type === "kind" && !link && (
        <p className="text-sm opacity-70">{t("status.kindByHand", { kind: t(`kinds.${decision.kind}`) })}</p>
      )}
      {!link && !status.open && !status.isTransfer && !decision && <p className="text-sm opacity-70">{t("status.none")}</p>}

      {proposals.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("proposals.title")}</h3>
          <ul className="flex flex-col gap-2">
            {proposals.map((proposal) => (
              <li key={proposal.pairId} className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-300 p-2">
                <div className="min-w-0">
                  <p>{texts.partnerLabel(booking, proposal.partner)}</p>
                  {proposal.partner.visible && <p className="text-sm opacity-70">{texts.bookingLine(proposal.partner.booking)}</p>}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={pending}
                    onClick={() => run(`proposals/${proposal.pairId}`, { action: "accept" })}
                  >
                    {t("proposals.accept")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={pending}
                    onClick={() => run(`proposals/${proposal.pairId}`, { action: "reject" })}
                  >
                    {t("proposals.reject")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="collapse collapse-arrow border border-base-300">
        <summary className="collapse-title text-sm font-medium">{t("actions.correct")}</summary>
        <div className="collapse-content flex flex-col gap-4">
          {!link && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="transfer-candidate">
                {t("actions.chooseCandidate")}
              </label>
              {status.candidates.length === 0 ? (
                <p className="text-sm opacity-70">{t("actions.noCandidates")}</p>
              ) : (
                <div className="join w-full">
                  <select
                    id="transfer-candidate"
                    className="select join-item w-full"
                    value={candidate}
                    onChange={(event) => setCandidate(event.target.value)}
                  >
                    {status.candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {texts.bookingLine(c)}
                        {c.counterparty ? ` · ${c.counterparty}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn join-item"
                    disabled={pending || !candidate}
                    onClick={() => act({ action: "link", partnerId: candidate })}
                  >
                    {t("actions.link")}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="transfer-kind">
              {t("actions.changeKind")}
            </label>
            <div className="join w-full">
              <select
                id="transfer-kind"
                className="select join-item w-full"
                value={kind}
                onChange={(event) => setKind(event.target.value as TransferKind)}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn join-item" disabled={pending} onClick={() => act({ action: "set-kind", kind })}>
                {t("actions.apply")}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="transfer-target">
              {t("actions.withoutPartner")}
            </label>
            <div className="join w-full">
              <select
                id="transfer-target"
                className="select join-item w-full"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="external">{t("actions.externalAccount")}</option>
                {targets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn join-item"
                disabled={pending}
                onClick={() =>
                  act({
                    action: "no-partner",
                    target: target === "external" ? { type: "external" } : { type: "account", accountId: target },
                    ...(canLearn && learn && rulePattern.trim() ? { rule: { field: ruleField, pattern: rulePattern } } : {}),
                  })
                }
              >
                {t("actions.mark")}
              </button>
            </div>
            {canLearn && (
              <div className="flex flex-col gap-1">
                <label className="label cursor-pointer justify-start gap-2 whitespace-normal">
                  <input type="checkbox" className="checkbox checkbox-sm" checked={learn} onChange={(e) => setLearn(e.target.checked)} />
                  <span className="text-base-content">{t("actions.learnRule")}</span>
                </label>
                {learn && (
                  <>
                    <input
                      aria-label={t(ruleField === "counterparty" ? "actions.ruleCounterparty" : "actions.ruleReference")}
                      type="text"
                      className="input input-sm w-full"
                      value={rulePattern}
                      maxLength={200}
                      onChange={(e) => setRulePattern(e.target.value)}
                    />
                    <p className="text-xs opacity-70">
                      {t(ruleField === "counterparty" ? "actions.ruleCounterparty" : "actions.ruleReference")}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </details>

      {error && (
        <p role="alert" className="text-error text-sm">
          {t(`actions.${error}`)}
        </p>
      )}
    </section>
  );
}
