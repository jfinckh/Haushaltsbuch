"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { formatEuro } from "@/shared/money";
import type { AccountTransfers } from "../types";
import { useTransferAction } from "./use-transfer-action";
import { useTransferTexts } from "./use-transfer-texts";

type Props = {
  overview: AccountTransfers;
  /** The accounts the viewer may see (for names). */
  accounts: { id: string; name: string }[];
  /** Link to one booking: `${href}/${id}`. Default: /transactions */
  href?: string;
  /** Endpoint of the transfers API. Default: /api/transfers */
  endpoint?: string;
};

/** Open and proposed transfers of an account; nothing when there are none. */
export function TransferInbox({ overview, accounts, href = "/transactions", endpoint }: Props) {
  const t = useTranslations("transfers");
  const texts = useTransferTexts({ accounts: Object.fromEntries(accounts.map((a) => [a.id, a.name])) });
  const { run, pending, error } = useTransferAction(endpoint);
  if (overview.open.length === 0 && overview.proposals.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {overview.proposals.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="font-semibold">{t("inbox.proposals")}</h2>
          <ul className="flex flex-col gap-2">
            {overview.proposals.map((proposal) => (
              <li key={proposal.pairId} className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-300 p-2">
                <Link href={`${href}/${proposal.booking.id}`} className="min-w-0 hover:underline">
                  <p className="truncate">{texts.bookingLine(proposal.booking)}</p>
                  <p className="text-sm opacity-70">{texts.partnerLabel(proposal.booking, proposal.partner)}</p>
                </Link>
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
        </section>
      )}
      {overview.open.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="font-semibold">{t("inbox.open")}</h2>
          <ul className="flex flex-col">
            {overview.open.map((booking) => (
              <li key={booking.id}>
                <Link
                  href={`${href}/${booking.id}`}
                  className="flex items-center justify-between gap-3 border-b border-base-300/70 px-1 py-2.5 transition-colors hover:bg-base-200/60"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{booking.counterparty ?? booking.reference ?? t("title")}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-sm text-base-content/60">
                      {texts.date(booking.date)}
                      {booking.overdue && <span className="badge badge-soft badge-warning badge-sm">{t("inbox.overdue")}</span>}
                    </p>
                  </div>
                  <span className={`shrink-0 font-medium whitespace-nowrap ${booking.amountCents < 0 ? "" : "text-success"}`}>
                    {formatEuro(booking.amountCents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && (
        <p role="alert" className="text-error text-sm">
          {t(`actions.${error}`)}
        </p>
      )}
    </div>
  );
}
