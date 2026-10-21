import { describe, expect, it } from "vitest";
import { CATEGORY_GROUPS, categoryKeysFor, categoryMessageKey, isCategoryFor } from "./categories";
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
