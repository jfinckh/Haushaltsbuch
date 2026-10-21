// IBAN rules (ISO 13616): normalize, check, format. Browser-safe, so the form can check early.

/** Removes spaces and upper-cases, e.g. "de89 3704 ..." → "DE893704...". */
export function normalizeIban(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

/** Whether a normalized IBAN has a valid shape and check digits (mod 97). */
export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = char >= "A" ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Groups of four for display, e.g. "DE89 3704 0044 0532 0130 00". */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, "$1 ");
}
