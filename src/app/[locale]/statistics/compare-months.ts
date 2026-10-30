// The months the statistics page compares: the main month (?month) and up to MAX_COMPARE more
// (?compare=YYYY-MM,YYYY-MM). Pure, so server pages and client components can both use it.

/** How many months can be added to the main month. */
export const MAX_COMPARE = 2;

/** The earliest month insights accepts. */
const FIRST_MONTH = "1970-01";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The compared months from the address, newest first: valid, not in the future, not the main month,
 * no duplicates, at most MAX_COMPARE. Anything else is dropped without a message.
 */
export function chosenCompare(value: string | undefined, main: string, current: string): string[] {
  if (!value) return [];
  const months = value
    .split(",")
    .map((m) => m.trim())
    .filter((m) => MONTH.test(m) && m >= FIRST_MONTH && m <= current && m !== main);
  return [...new Set(months)].slice(0, MAX_COMPARE).sort().reverse();
}

/** The main month and the compared months together, newest first. */
export function shownMonths(main: string, compare: string[]): string[] {
  return [main, ...compare].sort().reverse();
}

/** The address parameters for the compared months, e.g. for the account switcher. */
export function compareParams(compare: string[]): Record<string, string> {
  return compare.length > 0 ? { compare: compare.join(",") } : {};
}

/** A link to the statistics page; a compared month equal to the main month is left out. */
export function statisticsHref({ account, month, compare }: { account: string; month: string; compare: string[] }): string {
  const params = new URLSearchParams({ account, month, ...compareParams(compare.filter((m) => m !== month)) });
  // Commas stay readable in the address.
  return `/statistics?${params.toString().replaceAll("%2C", ",")}`;
}
