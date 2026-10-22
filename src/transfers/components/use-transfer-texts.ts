"use client";

import { useFormatter, useTranslations } from "next-intl";
import { formatEuro } from "@/shared/money";
import type { PartnerView, TransferBookingView } from "../types";

export type Names = {
  /** Names of the accounts the viewer may see (id → name). */
  accounts: Record<string, string>;
};

/** Texts shared by the panel and the inbox: the partner of a transfer, a booking line. */
export function useTransferTexts({ accounts }: Names) {
  const t = useTranslations("transfers.status");
  const format = useFormatter();
  const date = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });

  return {
    date,
    /** One line for a booking the viewer may see, e.g. "ING Giro · 02.10.2026 · 900,00 €". */
    bookingLine: (booking: TransferBookingView) =>
      [accounts[booking.accountId] ?? t("anotherAccount"), date(booking.date), formatEuro(booking.amountCents)].join(" · "),
    /**
     * The partner of `own`, e.g. "Umbuchung an ING Giro" or, for a hidden partner, only its owner:
     * "Umbuchung von Max (privat)".
     */
    partnerLabel: (own: TransferBookingView, partner: PartnerView) => {
      const incoming = own.amountCents > 0;
      if (partner.visible) {
        const account = accounts[partner.booking.accountId] ?? t("anotherAccount");
        return t(incoming ? "linkedFrom" : "linkedTo", { account });
      }
      const name = partner.ownerName || t("aMember");
      return t(incoming ? "hiddenFrom" : "hiddenTo", { name });
    },
  };
}
