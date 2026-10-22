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
