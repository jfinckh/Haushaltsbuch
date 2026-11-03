import type { Result } from "@/shared/result";
import type { Caller } from "@/shared/rls";
import type { TransactionView } from "@/transactions/server";
import type { IntervalMonths } from "./validation";

// The contract of the recurring part for pages and routes. Every call is about the caller's own
// view: a template exists for whoever may see its account.

/** archived: its account is archived, so nothing is booked; ended: past its end date. */
export type TemplateStatus = "active" | "paused" | "ended" | "archived";

/** A template as callers see it. The creator's user id is never sent. */
export type TemplateView = {
  id: string;
  accountId: string;
  amountCents: number;
  kind: TransactionView["kind"];
  category: string | null;
  counterparty: string | null;
  /** Formatted in groups of four, or null. */
  counterpartyIban: string | null;
  reference: string | null;
  intervalMonths: IntervalMonths;
  dayOfMonth: number;
  nextDueDate: string;
  endDate: string | null;
  status: TemplateStatus;
  createdByMe: boolean;
};

type Reason = "invalid-input" | "not-found";

export type CreateWithBookingResult = Result<{ transaction: TransactionView; templateId: string }, Reason>;

export type TemplateResult = Result<{ template: TemplateView }, Reason>;

export interface Recurring {
  /**
   * Adds a booking (form input plus `repeat: { intervalMonths, endDate }`) and its template in one
   * transaction: both or neither. The booking is the first date; the hourly run books the next ones.
   */
  createWithBooking(caller: Caller, input: unknown): Promise<CreateWithBookingResult>;

  /** Visible templates, next due first. `archivedAccountIds` marks templates of archived accounts. */
  listTemplates(caller: Caller, options?: { archivedAccountIds?: ReadonlySet<string> }): Promise<TemplateView[]>;

  /**
   * `{ action }`: pause; resume (from the next date on or after today, the pause is not caught up);
   * end (today is the last day).
   */
  act(caller: Caller, id: string, input: unknown): Promise<TemplateResult>;

  /** Deletes a visible template; its bookings stay. False if there is none the caller may see. */
  deleteTemplate(caller: Caller, id: string): Promise<boolean>;
}
