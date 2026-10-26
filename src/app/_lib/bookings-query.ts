import { isOwnCategoryKey } from "@/transactions";

const PAGE_SIZE = 200;
const MAX_LIMIT = 5000;
const KINDS = ["expense", "income", "transfer", "saving"];

type Group = { key: string; subcategories: { key: string }[] };

/** What the page knows about categories: the catalog and whether the selected account is shared. */
export type CategoryContext = {
  catalog: { names: Record<string, string>; shared: Group[]; private: Group[] };
  /** A shared account never offers personal own categories. */
  sharedAccount: boolean;
};

export type BookingsFilterValues = {
  month?: string;
  year?: string;
  from?: string;
  to?: string;
  kind?: string;
  category?: string;
  q?: string;
};

type Raw = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const isMonth = (value: string | undefined): value is string => /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? "");
const isYear = (value: string | undefined): value is string => /^\d{4}$/.test(value ?? "") && Number(value) >= 1970;
const isDay = (value: string | undefined): value is string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value ?? "");
};

/** Standard keys are groups ("housing") or subcategories ("housing.rent"); hidden ones are not in the catalog. */
const STANDARD_KEY = /^[a-zA-Z]+(\.[a-zA-Z]+)?$/;

const keysOf = (groups: Group[]) => new Set(groups.flatMap((group) => [group.key, ...group.subcategories.map((sub) => sub.key)]));

function isKnownCategory(value: string, { catalog, sharedAccount }: CategoryContext): boolean {
  if (value === "none") return true;
  if (!isOwnCategoryKey(value)) return STANDARD_KEY.test(value);
  if (!(value in catalog.names) && !keysOf(catalog.private).has(value) && !keysOf(catalog.shared).has(value)) return false;
  // Own keys that only the private choices offer (and archived ones, which no list offers) can be personal.
  if (sharedAccount && keysOf(catalog.private).has(value) && !keysOf(catalog.shared).has(value)) return false;
  return true;
}

/**
 * Cleans the raw search params of the bookings page: malformed values are dropped (so the page falls
 * back to the current month, all kinds, 200 rows), only one period stays (month, then year, then
 * range) and a category must be one the page can know. A reversed range is kept; the service
 * rejects it and the page warns.
 */
export function sanitizeBookingsQuery(raw: Raw, categories: CategoryContext): { values: BookingsFilterValues; limit: number } {
  const month = first(raw.month);
  const year = first(raw.year);
  const from = first(raw.from);
  const to = first(raw.to);
  const kind = first(raw.kind);
  const category = first(raw.category);
  const q = first(raw.q);
  const limitText = first(raw.limit);

  const period: Partial<BookingsFilterValues> = isMonth(month)
    ? { month }
    : isYear(year)
      ? { year }
      : { from: isDay(from) ? from : undefined, to: isDay(to) ? to : undefined };
  const values: BookingsFilterValues = {
    ...period,
    kind: kind !== undefined && KINDS.includes(kind) ? kind : undefined,
    category: category !== undefined && isKnownCategory(category, categories) ? category : undefined,
    q: q || undefined,
  };
  const number = limitText !== undefined && /^\d+$/.test(limitText) ? Number(limitText) : NaN;
  return {
    values: Object.fromEntries(Object.entries(values).filter(([, value]) => !!value)) as BookingsFilterValues,
    limit: number >= 1 && number <= MAX_LIMIT ? number : PAGE_SIZE,
  };
}
