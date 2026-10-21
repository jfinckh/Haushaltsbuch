import type { TransactionValues } from "@/transactions/server";

// The result of reading a bank export. Errors name a reason and at most a line number, never
// content from the file (CLAUDE.md, logging).

export type Bank = "ing" | "trade_republic";

export type ParseErrorReason = "too-large" | "empty" | "unknown-format" | "invalid-row" | "unsupported-currency";

export type ParseError = { ok: false; reason: ParseErrorReason; line?: number };

/** One booking read from the file, before the target account is known. */
export type ParsedRow = {
  /** 1-based line in the file. */
  line: number;
  bookingDate: string;
  amountCents: number;
  kind: TransactionValues["kind"];
  category: string | null;
  counterparty: string | null;
  counterpartyIban: string | null;
  reference: string | null;
  /** The row as the file has it: column name → value. Stored encrypted. */
  raw: Record<string, string>;
  /** What makes this booking unique in its bank's exports; becomes the fingerprint. */
  dedupKey: string;
};

export type ParsedFile = {
  ok: true;
  bank: Bank;
  rows: ParsedRow[];
  /** Balance after the newest booking, if the export states it (ING). */
  closingBalanceCents: number | null;
  /** Rows that cannot become a booking (amount 0). */
  skipped: number;
};

export type ParseResult = ParsedFile | ParseError;
