import { z } from "zod";

// Money is always an integer number of cents. These helpers read and write the German format
// ("1.234,56") with string arithmetic only, never through floats.

// Optional sign, then digits either grouped by dots in threes ("1.234.567") or ungrouped
// ("1234567"), then optionally a comma with one or two decimals, then optionally a euro sign.
const GERMAN_AMOUNT = /^([+\-−])?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*€?$/;

/** Parses a German amount like "1.234,56", "-12,5" or "3 €" into cents. Returns null if invalid. */
export function parseGermanAmount(input: string): number | null {
  const match = GERMAN_AMOUNT.exec(input.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const digits = (whole.replaceAll(".", "") + fraction.padEnd(2, "0")).replace(/^0+(?=\d)/, "");
  const cents = Number(digits);
  if (!Number.isSafeInteger(cents)) return null;
  if (cents === 0) return 0;
  return sign === "-" || sign === "−" ? -cents : cents;
}

/** Formats cents as a German amount without currency, e.g. 123456 → "1.234,56". */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("Amount must be a safe integer of cents");
  const negative = cents < 0;
  const digits = String(Math.abs(cents)).padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+$)/g, ".");
  return `${negative ? "-" : ""}${whole},${digits.slice(-2)}`;
}

/** Formats cents as euros, e.g. -5000 → "-50,00 €". */
export function formatEuro(cents: number): string {
  return `${formatCents(cents)} €`;
}

/** A German amount as text (form field) that becomes cents. */
export const germanAmountSchema = z.string().transform((value, ctx) => {
  const cents = parseGermanAmount(value);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: 'Enter an amount like "1.234,56".' });
    return z.NEVER;
  }
  return cents;
});
