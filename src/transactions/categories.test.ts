import { describe, expect, it } from "vitest";
import { CATEGORY_GROUPS, categoryKeysFor, categoryMessageKey, isCategoryFor, spendingByGroup } from "./categories";
import { messages } from "./messages";

describe("categories", () => {
  it("offers groups and their subcategories for expenses", () => {
    expect(isCategoryFor("expense", "groceries")).toBe(true);
    expect(isCategoryFor("expense", "groceries.supermarket")).toBe(true);
    expect(isCategoryFor("expense", "other")).toBe(true);
  });

  it("keeps expense and income categories apart", () => {
    expect(isCategoryFor("income", "salary")).toBe(true);
    expect(isCategoryFor("income", "groceries")).toBe(false);
    expect(isCategoryFor("expense", "salary")).toBe(false);
  });

  it("has no categories for transfers and saving", () => {
    expect(categoryKeysFor("transfer")).toEqual([]);
    expect(categoryKeysFor("saving")).toEqual([]);
    expect(isCategoryFor("transfer", "other")).toBe(false);
  });

  it("rejects unknown keys and subcategories under the wrong group", () => {
    expect(isCategoryFor("expense", "groceries.fuel")).toBe(false);
    expect(isCategoryFor("expense", "nope")).toBe(false);
    expect(isCategoryFor("expense", "")).toBe(false);
  });

  it("has unique keys and a name in both languages for each", () => {
    const keys = [...categoryKeysFor("expense"), ...categoryKeysFor("income")];
    expect(new Set(keys).size).toBe(keys.length);
    for (const locale of ["de", "en"] as const) {
      for (const key of keys) {
        const name = categoryMessageKey(key)
          .split(".")
          .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages[locale]);
        expect(typeof name === "string" && name.length > 0, `${locale} ${key}`).toBe(true);
      }
    }
    expect(CATEGORY_GROUPS.length).toBeGreaterThan(0);
  });
});

describe("spending by category group", () => {
  it("folds subcategories into their group, largest first, as positive amounts", () => {
    expect(
      spendingByGroup([
        { category: "groceries.supermarket", sumCents: -3000 },
        { category: "groceries", sumCents: -1000 },
        { category: "housing.rent", sumCents: -80000 },
        { category: "leisure.restaurant", sumCents: -2500 },
      ]),
    ).toEqual({
      totalCents: 86500,
      groups: [
        { group: "housing", cents: 80000 },
        { group: "groceries", cents: 4000 },
        { group: "leisure", cents: 2500 },
      ],
    });
  });

  it("lets refunds lower their group and leaves out groups at zero or below", () => {
    expect(
      spendingByGroup([
        { category: "shopping.clothing", sumCents: -5000 },
        { category: "shopping", sumCents: 2000 },
        { category: "health.pharmacy", sumCents: -1000 },
        { category: "health", sumCents: 1000 },
        { category: "mobility.fuel", sumCents: 3000 },
      ]),
    ).toEqual({ totalCents: 3000, groups: [{ group: "shopping", cents: 3000 }] });
  });

  it("keeps expenses without category as their own row", () => {
    expect(
      spendingByGroup([
        { category: null, sumCents: -1500 },
        { category: "other", sumCents: -500 },
      ]),
    ).toEqual({
      totalCents: 2000,
      groups: [
        { group: null, cents: 1500 },
        { group: "other", cents: 500 },
      ],
    });
  });

  it("has no rows without expenses", () => {
    expect(spendingByGroup([])).toEqual({ totalCents: 0, groups: [] });
  });
});
