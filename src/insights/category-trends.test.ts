import { describe, expect, it } from "vitest";
import { categoryTrends, TREND_MONTHS } from "./category-trends";

/** 13 months newest first (the current one and the 12 before it), spending per group as given. */
function series(byMonthIndex: Record<number, Record<string, number>>) {
  return Array.from({ length: TREND_MONTHS + 1 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 9 - i, 1));
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const groups = Object.entries(byMonthIndex[i] ?? {}).map(([group, cents]) => ({ group: group === "none" ? null : group, cents }));
    return { month, totalCents: groups.reduce((sum, g) => sum + g.cents, 0), groups };
  });
}

describe("category trends", () => {
  it("lists the 12 trend months oldest first, ending with the current month", () => {
    const { months } = categoryTrends(series({}));
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-11");
    expect(months.at(-1)).toBe("2026-10");
  });

  it("gives each group's spending per trend month, oldest first, with 0 for months without spending", () => {
    const { groups } = categoryTrends(series({ 0: { groceries: 1000 }, 2: { groceries: 3000 }, 12: { groceries: 99999 } }));
    expect(groups).toHaveLength(1);
    expect(groups[0].trend).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 3000, 0, 1000]);
  });

  it("averages over the 3, 6 and 12 complete months, never the current one, rounded to cents", () => {
    // Index 0 is the current month; 1–12 are the complete months.
    const { groups } = categoryTrends(series({ 0: { groceries: 50000 }, 1: { groceries: 100 }, 2: { groceries: 200 }, 3: { groceries: 1 }, 6: { groceries: 600 }, 12: { groceries: 1200 } }));
    expect(groups[0]).toMatchObject({
      group: "groceries",
      average3Cents: 100, // (100 + 200 + 1) / 3 = 100.33
      average6Cents: 150, // (301 + 600) / 6 = 150.17
      average12Cents: 175, // (901 + 1200) / 12 = 175.08
    });
  });

  it("keeps a group that only has spending this month, with averages of 0", () => {
    const { groups } = categoryTrends(series({ 0: { leisure: 500 } }));
    expect(groups).toEqual([{ group: "leisure", trend: [...Array(11).fill(0), 500], average3Cents: 0, average6Cents: 0, average12Cents: 0 }]);
  });

  it("keeps a group that only had spending in the oldest complete month, which is outside the trend", () => {
    const { groups } = categoryTrends(series({ 12: { health: 1200 } }));
    expect(groups).toEqual([{ group: "health", trend: Array(12).fill(0), average3Cents: 0, average6Cents: 0, average12Cents: 100 }]);
  });

  it("orders the groups by their 12-month average, largest first; uncategorized is a group like any other", () => {
    const { groups } = categoryTrends(series({ 0: { shopping: 90000 }, 1: { groceries: 2400, none: 3600, shopping: 1200 } }));
    expect(groups.map((g) => g.group)).toEqual([null, "groceries", "shopping"]);
  });

  it("has no groups without any spending", () => {
    expect(categoryTrends(series({})).groups).toEqual([]);
  });
});
