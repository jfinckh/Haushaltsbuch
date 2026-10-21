// What callers see of transfers. Browser-safe: the components get these shapes as props.

export type TransferKind = "expense" | "income" | "transfer" | "saving";

/** A booking the caller may see, as far as transfers show it. */
export type TransferBookingView = {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  kind: TransferKind;
  counterparty: string | null;
  reference: string | null;
};

/**
 * The other side of a pair. Hidden: the caller may not see it (another member's private account);
 * only its account's owner is known, or null if they left the household.
 */
export type PartnerView = { visible: true; booking: TransferBookingView } | { visible: false; ownerUserId: string | null };

export type TransferPairView = {
  pairId: string;
  status: "linked" | "proposed";
  manual: boolean;
  partner: PartnerView;
};

export type TransferDecision =
  | { type: "kind"; kind: TransferKind }
  | { type: "no-partner"; target: "external" }
  | { type: "no-partner"; target: "account"; accountId: string | null };

export type TransferStatus = {
  booking: TransferBookingView;
  /** Type transfer or saving. */
  isTransfer: boolean;
  link: TransferPairView | null;
  proposals: TransferPairView[];
  decision: TransferDecision | null;
  /** A transfer still waiting for its partner. */
  open: boolean;
  /** Open for more than 14 days (by booking date). */
  overdue: boolean;
  /** Visible bookings that could be linked by hand. */
  candidates: TransferBookingView[];
};

export type AccountTransfers = {
  open: (TransferBookingView & { overdue: boolean })[];
  proposals: (TransferPairView & { booking: TransferBookingView })[];
};

export type NoPartnerTarget = { type: "external" } | { type: "account"; accountId: string };
