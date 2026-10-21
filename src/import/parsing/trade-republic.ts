import { isValidIban, normalizeIban } from "@/shared/iban";
import { splitFields, splitLines } from "./csv";
import { isIsoDate, MAX_COUNTERPARTY, MAX_REFERENCE, optionalText, toRecord } from "./fields";
import type { ParsedRow, ParseResult } from "./types";

// Trade Republic transaction export (app: Service → Kontoauszüge → Transaktionsexport): a comma CSV
// with a header line. The booking date is the `date` column; `datetime` is UTC and could fall on
// another day. `transaction_id` is unique and becomes the fingerprint.

const DELIMITER = ",";
const REQUIRED = ["date", "type", "amount", "currency", "transaction_id"];

/** Investment income: a booking type and category instead of the sign's proposal. */
const INCOME_TYPES = new Set(["INTEREST_PAYMENT", "DIVIDEND", "BENEFITS_SAVEBACK"]);

/** Whether a line is the header of a Trade Republic export. */
export function isTradeRepublicHeader(line: string): boolean {
  const fields = splitFields(line, DELIMITER);
  return REQUIRED.every((column) => fields.includes(column));
}

/**
 * A decimal-point amount ("-6.900000") as cents, by string arithmetic. Null if it is not a number
 * or has a fraction of a cent.
 */
export function parseDecimalAmount(value: string): number | null {
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (/[^0]/.test(fraction.slice(2))) return null;
  const cents = Number(whole + fraction.slice(0, 2).padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return sign === "-" && cents !== 0 ? -cents : cents;
}

function kindOf(type: string, amountCents: number): Pick<ParsedRow, "kind" | "category"> {
  if (type === "BUY") return { kind: "saving", category: null };
  if (type === "SELL") return { kind: "transfer", category: null };
  if (INCOME_TYPES.has(type)) return { kind: "income", category: "investmentIncome" };
  return { kind: amountCents < 0 ? "expense" : "income", category: null };
}

export function parseTradeRepublic(text: string): ParseResult {
  const lines = splitLines(text);
  if (!isTradeRepublicHeader(lines[0] ?? "")) return { ok: false, reason: "unknown-format" };
  const header = splitFields(lines[0], DELIMITER);
  const rows: ParsedRow[] = [];
  let skipped = 0;

  for (let index = 1; index < lines.length; index++) {
    const line = index + 1;
    if (lines[index].trim() === "") continue;
    const fields = splitFields(lines[index], DELIMITER);
    if (fields.length < header.length) return { ok: false, reason: "invalid-row", line };
    const raw = toRecord(header, fields);
    const amountCents = parseDecimalAmount(raw.amount);
    if (!isIsoDate(raw.date) || amountCents === null || !raw.transaction_id.trim()) {
      return { ok: false, reason: "invalid-row", line };
    }
    if (raw.currency.trim() !== "EUR") return { ok: false, reason: "unsupported-currency", line };
    if (amountCents === 0) {
      skipped++;
      continue;
    }

    const iban = normalizeIban(raw.counterparty_iban ?? "");
    rows.push({
      line,
      bookingDate: raw.date,
      amountCents,
      ...kindOf(raw.type.trim(), amountCents),
      counterparty: optionalText(raw.counterparty_name || raw.name, MAX_COUNTERPARTY),
      counterpartyIban: isValidIban(iban) ? iban : null,
      reference: optionalText(raw.payment_reference || raw.description, MAX_REFERENCE),
      raw,
      dedupKey: raw.transaction_id.trim(),
    });
  }

  return { ok: true, bank: "trade_republic", rows, closingBalanceCents: null, skipped };
}
