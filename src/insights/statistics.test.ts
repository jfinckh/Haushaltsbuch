import { describe, expect, it } from "vitest";
import { barScale, compareMonths, savingsRate, statisticsRows } from "./statistics";

const summary = (month: string, incomeCents: number, expenseCents: number, savingCents: number) => ({
  month,
  incomeCents,
  expenseCents,
  savingCents,
  availableCents: incomeCents + expenseCents + savingCents,
});

describe("savings rate", () => {
  it("is saved / income", () => {
    expect(savingsRate(200000, -25000)).toBe(0.125);
  });

  it("has no value without income", () => {
    expect(savingsRate(0, -25000)).toBeNull();
    expect(savingsRate(-100, 0)).toBeNull();
  });
});

describe("statistics rows", () => {
  it("adds the savings rate, and without contributions none", () => {
    expect(statisticsRows([summary("2026-10", 200000, -50000, -25000), summary("2026-09", 0, -1000, 0)])).toEqual([
      { month: "2026-10", incomeCents: 200000, expenseCents: -50000, savingCents: -25000, availableCents: 125000, contributionCents: null, savingsRate: 0.125 },
      { month: "2026-09", incomeCents: 0, expenseCents: -1000, savingCents: 0, availableCents: -1000, contributionCents: null, savingsRate: null },
    ]);
  });

  it("adds the contribution of the same month to the available amount, but never to the savings rate", () => {
    const rows = statisticsRows(
      [summary("2026-10", 200000, -50000, -25000), summary("2026-09", 100000, 0, 0)],
      [
        { month: "2026-10", cents: -120000 },
        { month: "2026-09", cents: 0 },
      ],
    );
    expect(rows[0]).toMatchObject({ contributionCents: -120000, availableCents: 5000, savingsRate: 0.125 });
    expect(rows[1]).toMatchObject({ contributionCents: 0, availableCents: 100000, savingsRate: 0 });
  });
});

describe("comparison with the previous month", () => {
  it("gives the change in money spent and in the savings rate (percentage points)", () => {
    const [current, previous] = statisticsRows([summary("2026-10", 200000, -50000, -25000), summary("2026-09", 200000, -62000, -10000)]);
    expect(compareMonths(current, previous)).toEqual({ expenseChangeCents: -12000, savingsRateChangePoints: 7.5 });
  });

  it("gives no rate change when a month has no savings rate", () => {
    const [current, previous] = statisticsRows([summary("2026-10", 200000, -50000, -25000), summary("2026-09", 0, -40000, 0)]);
    expect(compareMonths(current, previous)).toEqual({ expenseChangeCents: 10000, savingsRateChangePoints: null });
  });
});

describe("bar scale", () => {
  it("is the largest income or money spent of all months", () => {
    expect(barScale(statisticsRows([summary("2026-10", 200000, -50000, 0), summary("2026-09", 1000, -300000, 0)]))).toBe(300000);
  });

  it("is never zero, so empty months draw empty bars", () => {
    expect(barScale(statisticsRows([summary("2026-10", 0, 0, 0)]))).toBe(1);
    expect(barScale([])).toBe(1);
  });
});
