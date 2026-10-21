import { parseGermanAmount } from "@/shared/money";
import { splitFields, splitLines } from "./csv";
import { germanDate, MAX_COUNTERPARTY, MAX_REFERENCE, normalizeForKey, optionalText, toRecord } from "./fields";
import type { ParsedRow, ParseResult } from "./types";

// ING exports (Girokonto and Gemeinschaftskonto have the same format): a header block
// ("Saldo;703,26;EUR" is the balance after the newest booking), then a semicolon table with German
// dates and amounts, newest first. Columns are found by name. The sign proposes the booking type.

const DELIMITER = ";";

/** Whether a line is the header of ING's booking table. */
export function isIngHeader(line: string): boolean {
  const fields = splitFields(line, DELIMITER);
  return fields[0] === "Buchung" && fields.includes("Betrag") && fields.includes("Verwendungszweck");
}

export function parseIng(text: string): ParseResult {
  const lines = splitLines(text);
  const headerIndex = lines.findIndex(isIngHeader);
  if (headerIndex < 0) return { ok: false, reason: "unknown-format" };

  let closingBalanceCents: number | null = null;
  for (const line of lines.slice(0, headerIndex)) {
    const [label, value] = splitFields(line, DELIMITER);
    if (label === "Saldo" && value) closingBalanceCents = parseGermanAmount(value);
  }

  const header = splitFields(lines[headerIndex], DELIMITER);
  const amountColumn = header.indexOf("Betrag");
  const currencyColumn = amountColumn + 1;
  const rows: ParsedRow[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;

  for (let index = headerIndex + 1; index < lines.length; index++) {
    const line = index + 1;
    if (lines[index].trim() === "") continue;
    const fields = splitFields(lines[index], DELIMITER);
    if (fields.length < header.length) return { ok: false, reason: "invalid-row", line };
    const raw = toRecord(header, fields);
    const bookingDate = germanDate(raw.Buchung);
    const amountCents = parseGermanAmount(fields[amountColumn]);
    if (!bookingDate || amountCents === null) return { ok: false, reason: "invalid-row", line };
    if ((fields[currencyColumn] ?? "EUR").trim() !== "EUR") return { ok: false, reason: "unsupported-currency", line };
    if (amountCents === 0) {
      skipped++;
      continue;
    }

    const counterparty = optionalText(raw["Auftraggeber/Empfänger"], MAX_COUNTERPARTY);
    const reference = optionalText(raw.Verwendungszweck, MAX_REFERENCE);
    // Same day, amount and texts: count them, so two identical purchases stay two bookings.
    const sameRow = [bookingDate, amountCents, normalizeForKey(raw["Auftraggeber/Empfänger"]), normalizeForKey(raw.Verwendungszweck)].join("|");
    const counter = (seen.get(sameRow) ?? 0) + 1;
    seen.set(sameRow, counter);

    rows.push({
      line,
      bookingDate,
      amountCents,
      kind: amountCents < 0 ? "expense" : "income",
      category: null,
      counterparty,
      counterpartyIban: null,
      reference,
      raw,
      dedupKey: `${sameRow}|${counter}`,
    });
  }

  return { ok: true, bank: "ing", rows, closingBalanceCents, skipped };
}
