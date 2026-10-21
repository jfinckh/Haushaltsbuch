// Small helpers the bank parsers share.

/** Booking limits of the transactions part; the raw row keeps the full text. */
export const MAX_COUNTERPARTY = 200;
export const MAX_REFERENCE = 500;

/** Trimmed text cut to `max` characters; empty means null. */
export function optionalText(value: string | undefined, max: number): string | null {
  const text = (value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

/** Text for comparing rows: Unicode-normalized, whitespace collapsed, lower case. */
export function normalizeForKey(value: string | null): string {
  return (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("de");
}

/** Whether `value` is a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** "DD.MM.YYYY" → "YYYY-MM-DD", or null if it is no real date. */
export function germanDate(value: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isIsoDate(iso) ? iso : null;
}

/** Column name → value for one record; duplicate names get a suffix ("Währung", "Währung 2"). */
export function toRecord(header: string[], fields: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  header.forEach((name, index) => {
    let key = name;
    for (let n = 2; key in record; n++) key = `${name} ${n}`;
    record[key] = fields[index] ?? "";
  });
  return record;
}
