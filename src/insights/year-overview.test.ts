import { describe, expect, it } from "vitest";
import { statisticsRows } from "./statistics";
import { yearCategories, yearTotals } from "./year-overview";

const summary = (month: string, incomeCents: number, expenseCents: number, savingCents: number) => ({
  month,
  incomeCents,
  expenseCents,
  savingCents,
  availableCents: incomeCents + expenseCents + savingCents,
});

describe("year totals", () => {
  it("sums the months and takes the savings rate of the year's totals", () => {
    const rows = statisticsRows([summary("2026-02", 300000, -100000, -50000), summary("2026-01", 100000, -20000, 0)]);
    expect(yearTotals(rows)).toEqual({
      incomeCents: 400000,
      expenseCents: -120000,
      savingCents: -50000,
      availableCents: 230000,
      savingsRate: 0.125,
    });
  });

  it("has no savings rate without income, and zeros without months", () => {
    expect(yearTotals(statisticsRows([summary("2026-01", 0, -500, -100)])).savingsRate).toBeNull();
    expect(yearTotals([])).toEqual({ incomeCents: 0, expenseCents: 0, savingCents: 0, availableCents: 0, savingsRate: null });
  });
});

describe("year categories", () => {
  it("sums each group over the months, largest first; uncategorized is a group like any other", () => {
    const months = [
      { month: "2026-02", totalCents: 0, groups: [{ group: "groceries", cents: 3000 }, { group: null, cents: 9000 }] },
      { month: "2026-01", totalCents: 0, groups: [{ group: "groceries", cents: 7000 }, { group: "leisure", cents: 500 }] },
    ];
    expect(yearCategories(months)).toEqual({
      totalCents: 19500,
      groups: [
        { group: "groceries", cents: 10000 },
        { group: null, cents: 9000 },
        { group: "leisure", cents: 500 },
      ],
    });
  });

  it("is empty without spending", () => {
    expect(yearCategories([{ groups: [] }])).toEqual({ totalCents: 0, groups: [] });
  });
});
