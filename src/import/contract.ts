import type { Caller } from "@/shared/rls";
import type { TransactionValues } from "@/transactions/server";
import type { Bank, ParseErrorReason } from "./parsing/types";

// The contract of the import part. createImports implements it.

/** A merge proposal the user accepted: the file's line and the booking entered by hand. */
export type AcceptedMerge = { line: number; transactionId: string };

/**
 * An uploaded file for an account; `banks`: the banks whose files fit the account (default: any).
 * `merges`: the proposals from the preview the user accepted (confirm only); others are imported as new.
 */
export type UploadInput = { accountId: string; fileName: string; bytes: Uint8Array; banks?: Bank[]; merges?: AcceptedMerge[] };

/** The booking entered by hand that a row would merge with, so the user can judge the proposal. */
export type MergeTarget = {
  transactionId: string;
  date: string;
  counterparty: string | null;
  reference: string | null;
  kind: TransactionValues["kind"];
  category: string | null;
};

export type PreviewRow = {
  line: number;
  date: string;
  amountCents: number;
  kind: TransactionValues["kind"];
  category: string | null;
  counterparty: string | null;
  reference: string | null;
  /**
   * `duplicate`: already imported into this account (or twice in this file). `merge`: a booking
   * entered by hand matches (same amount, at most 3 days apart); `merge` names it.
   */
  status: "new" | "duplicate" | "merge";
  merge?: MergeTarget;
};

export type ImportPreview = {
  bank: Bank;
  periodFrom: string | null;
  periodTo: string | null;
  counts: { rows: number; new: number; duplicate: number; merge: number; skipped: number };
  /** Balance after the newest booking, if the export states it (ING). */
  closingBalanceCents: number | null;
  /** The opening balance that makes the account's balance match the file: closing balance − all its bookings. */
  openingBalanceFromFileCents: number | null;
  rows: PreviewRow[];
};

/** A confirmed import as callers see it. The creator's user id is never sent. */
export type ImportView = {
  id: string;
  accountId: string;
  bank: Bank;
  fileName: string;
  createdAt: string;
  periodFrom: string | null;
  periodTo: string | null;
  rowCount: number;
  newCount: number;
  duplicateCount: number;
  skippedCount: number;
  /** Rows merged into bookings entered by hand. */
  mergedCount: number;
  /** Bookings this import created that still exist (undo deletes them). */
  remainingCount: number;
  /** Bookings this import merged into that still exist (undo restores them). */
  mergedRemainingCount: number;
  createdByMe: boolean;
};

export type ImportFailure = {
  ok: false;
  /** `preview-outdated`: an accepted merge is no longer proposed (a booking changed since the preview). */
  reason: "invalid-input" | "not-found" | "wrong-bank" | "preview-outdated" | ParseErrorReason;
  line?: number;
};

export type PreviewResult = { ok: true; preview: ImportPreview } | ImportFailure;
export type ConfirmResult =
  | {
      ok: true;
      import: ImportView;
      openingBalanceFromFileCents: number | null;
      /** The bookings this import created (e.g. for transfer matching). */
      bookingIds: string[];
      /** The bookings entered by hand this import merged into. */
      mergedIds: string[];
    }
  | ImportFailure;

/** Bank file imports. Every call is about the caller's own view; their user id comes from the database. */
export interface Imports {
  /** What importing the file into the account would do. Stores nothing. */
  preview(caller: Caller, input: unknown): Promise<PreviewResult>;

  /**
   * Imports the file: creates the bookings of the new rows, merges the accepted proposals into the
   * bookings entered by hand, records fingerprints and raw rows (and, for merges, the booking's values
   * before) and the import itself, all in one database transaction. An accepted merge that is no
   * longer proposed fails the whole import (`preview-outdated`); a proposal not accepted is imported
   * as a new booking. Imports into the same account run one after the other, so two uploads at once
   * cannot create the same booking twice.
   */
  confirm(caller: Caller, input: unknown): Promise<ConfirmResult>;

  /** Imports of all visible accounts, or of one, newest first. */
  listImports(caller: Caller, accountId?: string): Promise<ImportView[]>;

  /**
   * Removes a visible import: deletes the bookings it created and restores the bookings entered by
   * hand it merged into (as before the import; a classification made by hand since then stays).
   * False if there is none the caller may see.
   */
  undoImport(caller: Caller, id: string): Promise<boolean>;
}
