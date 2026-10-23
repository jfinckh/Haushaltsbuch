import type { TransactionKind } from "./kinds";

// The fixed default categories (docs/konzept.md, "Kategorien & Sonderfälle"). Two levels: a booking
// stores a group key ("groceries") or a subcategory key ("groceries.supermarket"). Only expenses and
// income have categories; transfers and saving are booking types of their own. Names are translated
// in this part's messages (see categoryMessageKey). Browser-safe.

export type CategoryGroup = {
  key: string;
  kind: "expense" | "income";
  subcategories: readonly string[];
};

export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  { key: "housing", kind: "expense", subcategories: ["rent", "utilities", "electricity", "internet"] },
  { key: "groceries", kind: "expense", subcategories: ["supermarket", "drugstore"] },
  { key: "mobility", kind: "expense", subcategories: ["car", "fuel", "publicTransport"] },
  { key: "contracts", kind: "expense", subcategories: ["insurance", "subscriptions", "phone"] },
  { key: "leisure", kind: "expense", subcategories: ["restaurant", "goingOut", "hobbies", "travel"] },
  { key: "children", kind: "expense", subcategories: ["childcare", "clothing", "school"] },
  { key: "health", kind: "expense", subcategories: ["pharmacy", "doctor", "sports"] },
  { key: "shopping", kind: "expense", subcategories: ["clothing", "electronics", "household"] },
  { key: "other", kind: "expense", subcategories: [] },
  { key: "salary", kind: "income", subcategories: [] },
  { key: "childBenefit", kind: "income", subcategories: [] },
  { key: "investmentIncome", kind: "income", subcategories: [] },
  { key: "reimbursements", kind: "income", subcategories: [] },
  { key: "otherIncome", kind: "income", subcategories: [] },
];

/** The groups that fit a booking type, in display order. */
export function categoryGroupsFor(kind: TransactionKind): CategoryGroup[] {
  return CATEGORY_GROUPS.filter((group) => group.kind === kind);
}

/** Every category key (groups and subcategories) that fits a booking type. */
export function categoryKeysFor(kind: TransactionKind): string[] {
  return categoryGroupsFor(kind).flatMap((group) => [group.key, ...group.subcategories.map((sub) => `${group.key}.${sub}`)]);
}

/** Whether `key` is a category for this booking type. */
export function isCategoryFor(kind: TransactionKind, key: string): boolean {
  return categoryKeysFor(kind).includes(key);
}

/** The own part of a key: `c_` and the category's id (a UUID). */
const OWN_PART = /^c_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const STANDARD_GROUP_KEYS = new Set(CATEGORY_GROUPS.map((group) => group.key));

/**
 * Whether `key` has the format of an own category: `c_<id>` (group) or `<group>.c_<id>`
 * (subcategory of a standard or own group). Whether it exists and fits is the server's check.
 */
export function isOwnCategoryKey(key: string): boolean {
  const parts = key.split(".");
  if (parts.length > 2 || !OWN_PART.test(parts.at(-1)!)) return false;
  return parts.length === 1 || STANDARD_GROUP_KEYS.has(parts[0]) || OWN_PART.test(parts[0]);
}

/** The id of the own category a key names (its last part), or null for other keys. */
export function ownCategoryId(key: string): string | null {
  return isOwnCategoryKey(key) ? key.split(".").at(-1)!.slice(2) : null;
}

/** One group of a category choice with its subcategories. A null name is a standard one (translated). */
export type CategoryChoice = {
  key: string;
  kind: "expense" | "income";
  name: string | null;
  subcategories: { key: string; name: string | null }[];
};

/**
 * What a page needs to offer and show categories: the names of the own categories the caller may
 * see (archived ones too), and the choices for a shared and for one of the caller's private accounts.
 */
export type CategoryCatalog = { names: Record<string, string>; shared: CategoryChoice[]; private: CategoryChoice[] };

/** The standard categories as choices, in display order. */
export function standardChoices(): CategoryChoice[] {
  return CATEGORY_GROUPS.map((group) => ({
    key: group.key,
    kind: group.kind,
    name: null,
    subcategories: group.subcategories.map((sub) => ({ key: `${group.key}.${sub}`, name: null })),
  }));
}

/** The message key of a category's name, relative to this part's namespace. */
export function categoryMessageKey(key: string): string {
  const [group, sub] = key.split(".");
  return sub ? `categories.${group}.${sub}` : `categoryGroups.${group}`;
}

/** Spending of one category group in a month; `group: null` means expenses without category. */
export type GroupSpending = { group: string | null; cents: number };

/**
 * Folds net expense sums per stored category key (cents, signed as booked: money out is negative)
 * into category groups. Amounts become positive; refunds lower their group, and a group at zero or
 * below is left out. Largest first; the total is the sum of the rows.
 */
export function spendingByGroup(totals: readonly { category: string | null; sumCents: number }[]): {
  totalCents: number;
  groups: GroupSpending[];
} {
  const byGroup = new Map<string | null, number>();
  for (const { category, sumCents } of totals) {
    const group = category === null ? null : category.split(".")[0];
    byGroup.set(group, (byGroup.get(group) ?? 0) - sumCents);
  }
  const groups = [...byGroup]
    .map(([group, cents]) => ({ group, cents }))
    .filter((row) => row.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  return { totalCents: groups.reduce((sum, row) => sum + row.cents, 0), groups };
}
