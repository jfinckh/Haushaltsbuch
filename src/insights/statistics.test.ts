import { describe, expect, it } from "vitest";
import { barScale, compareFigures, savingsRate, statisticsComparison, statisticsRows, usualMonth } from "./statistics";

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

describe("comparing figures", () => {
  it("compares income, money spent, saved and left over the way people read them", () => {
    const [current, previous] = statisticsRows([summary("2026-10", 200000, -50000, -25000), summary("2026-09", 200000, -62000, -10000)]);
    expect(compareFigures(current, previous)).toEqual({
      income: { direction: "same", cents: 0 },
      // 120 € less spent, 150 € more saved.
      spent: { direction: "less", cents: -12000 },
      saved: { direction: "more", cents: 15000 },
      // 30 € less left over is under 10 % of 1.280 €: about the same.
      available: { direction: "same", cents: -3000 },
      savingsRate: { direction: "more", points: 7.5 },
    });
  });

  it("counts small differences as the same", () => {
    const [current, previous] = statisticsRows([summary("2026-10", 200500, -50900, -10000), summary("2026-09", 200000, -50000, -10100)]);
    expect(compareFigures(current, previous)).toMatchObject({
      income: { direction: "same", cents: 500 },
      spent: { direction: "same", cents: 900 },
      savingsRate: { direction: "same" },
    });
  });

  it("gives no rate change when a month has no savings rate", () => {
    const [current, previous] = statisticsRows([summary("2026-10", 200000, -50000, -25000), summary("2026-09", 0, -40000, 0)]);
    expect(compareFigures(current, previous).savingsRate).toBeNull();
    expect(compareFigures(current, previous).spent).toEqual({ direction: "more", cents: 10000 });
  });
});

describe("usual month", () => {
  it("averages the 3 newest months with bookings and skips empty ones", () => {
    const rows = statisticsRows([
      summary("2026-09", 300000, -90000, -30000),
      summary("2026-08", 0, 0, 0),
      summary("2026-07", 200000, -60000, -20000),
      summary("2026-06", 100000, -30000, -10001),
      summary("2026-05", 900000, 0, 0),
    ]);
    expect(usualMonth(rows)).toEqual({
      months: 3,
      incomeCents: 200000,
      expenseCents: -60000,
      savingCents: -20000,
      availableCents: 120000,
      savingsRate: 0.1,
    });
  });

  it("averages fewer months when there are fewer, and has none without bookings", () => {
    expect(usualMonth(statisticsRows([summary("2026-09", 100000, -1, 0)]))).toMatchObject({ months: 1, incomeCents: 100000, expenseCents: -1 });
    expect(usualMonth(statisticsRows([summary("2026-09", 0, 0, 0)]))).toBeNull();
    expect(usualMonth([])).toBeNull();
  });
});

describe("statistics comparison", () => {
  it("compares the chosen month with the month before and with the usual month", () => {
    const rows = statisticsRows([
      summary("2026-10", 200000, -80000, 0),
      summary("2026-09", 200000, -50000, 0),
      summary("2026-08", 200000, -30000, 0),
    ]);
    const comparison = statisticsComparison(rows);
    expect(comparison.previous?.spent).toEqual({ direction: "more", cents: 30000 });
    expect(comparison.usual?.month).toMatchObject({ months: 2, expenseCents: -40000 });
    expect(comparison.usual?.changes.spent).toEqual({ direction: "more", cents: 40000 });
  });

  it("has no previous comparison when the month before has no bookings, and nothing for a single month", () => {
    const rows = statisticsRows([summary("2026-10", 200000, -80000, 0), summary("2026-09", 0, 0, 0), summary("2026-08", 100000, 0, 0)]);
    expect(statisticsComparison(rows).previous).toBeNull();
    expect(statisticsComparison(rows).usual?.month.months).toBe(1);
    expect(statisticsComparison(rows.slice(0, 1))).toEqual({ previous: null, usual: null });
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
