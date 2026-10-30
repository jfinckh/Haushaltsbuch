import { describe, expect, it } from "vitest";
import { moneyFlow } from "./money-flow";
import { statisticsRows } from "./statistics";

const row = (incomeCents: number, expenseCents: number, savingCents: number) =>
  statisticsRows([{ month: "2026-10", incomeCents, expenseCents, savingCents, availableCents: incomeCents + expenseCents + savingCents }])[0];

/** The month's income as one group without category, as categoryIncomes gives it. */
const income = (cents: number) => (cents > 0 ? [{ group: null, cents }] : []);

const total = (nodes: { cents: number }[]) => nodes.reduce((sum, n) => sum + n.cents, 0);

describe("money flow", () => {
  it("sends income to categories, saving and what is left over", () => {
    const flow = moneyFlow(
      row(200000, -50000, -25000),
      [
        { group: "groceries", cents: 30000 },
        { group: "housing", cents: 20000 },
      ],
      [{ group: "salary", cents: 200000 }],
    );
    expect(flow).toEqual({
      month: "2026-10",
      totalCents: 200000,
      sources: [{ kind: "income", group: "salary", cents: 200000 }],
      targets: [
        { kind: "category", group: "groceries", cents: 30000 },
        { kind: "category", group: "housing", cents: 20000 },
        { kind: "saving", cents: 25000 },
        // Equal to the row's available amount.
        { kind: "left", cents: 125000 },
      ],
    });
  });

  it("splits income by category group, largest first, income without category last", () => {
    const flow = moneyFlow(row(311266, 0, 0), [], [
      { group: null, cents: 5600 },
      { group: "investmentIncome", cents: 666 },
      { group: "salary", cents: 300000 },
      { group: "otherIncome", cents: 5000 },
    ]);
    expect(flow.sources).toEqual([
      { kind: "income", group: "salary", cents: 300000 },
      { kind: "income", group: "otherIncome", cents: 5000 },
      { kind: "income", group: "investmentIncome", cents: 666 },
      { kind: "income", group: null, cents: 5600 },
    ]);
    expect(flow.targets).toEqual([{ kind: "left", cents: 311266 }]);
  });

  it("adds a shortfall when more went out than came in", () => {
    const flow = moneyFlow(row(100000, -150000, 0), [{ group: "housing", cents: 150000 }], income(100000));
    expect(flow.sources).toEqual([
      { kind: "income", group: null, cents: 100000 },
      { kind: "shortfall", cents: 50000 },
    ]);
    expect(flow.targets).toEqual([{ kind: "category", group: "housing", cents: 150000 }]);
    expect(flow.totalCents).toBe(150000);
  });

  it("shows refunds larger than their group and saving taken out as sources", () => {
    // Groceries 300 €, shopping refunded 50 € more than spent (left out by categorySpendings): 250 € spent.
    const flow = moneyFlow(row(0, -25000, 40000), [{ group: "groceries", cents: 30000 }], []);
    expect(flow.sources).toEqual([
      { kind: "refunds", cents: 5000 },
      { kind: "fromSavings", cents: 40000 },
    ]);
    expect(flow.targets).toEqual([
      { kind: "category", group: "groceries", cents: 30000 },
      { kind: "left", cents: 15000 },
    ]);
  });

  it("merges the groups after the 7 largest and keeps uncategorized spending apart", () => {
    const groups = [
      { group: null, cents: 900 },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ group: `g${n}`, cents: n * 1000 })),
    ];
    const spent = total(groups);
    const flow = moneyFlow(row(spent, -spent, 0), groups, income(spent));
    expect(flow.targets.map((t) => (t.kind === "category" ? t.group : t.kind))).toEqual([
      "g9", "g8", "g7", "g6", "g5", "g4", "g3", "otherCategories", "uncategorized",
    ]);
    expect(flow.targets.find((t) => t.kind === "otherCategories")?.cents).toBe(3000);
  });

  it("is empty for a month without bookings", () => {
    expect(moneyFlow(row(0, 0, 0), [], [])).toEqual({ month: "2026-10", totalCents: 0, sources: [], targets: [] });
  });

  it("always has equal sides", () => {
    const cases = [
      moneyFlow(row(123456, -98765, -4321), [{ group: "a", cents: 50000 }, { group: null, cents: 48765 }], income(123456)),
      moneyFlow(row(1000, -98765, 5000), [{ group: "a", cents: 100000 }], income(1000)),
      moneyFlow(row(-5000, -1000, 0), [{ group: "a", cents: 1000 }], []),
    ];
    for (const flow of cases) {
      expect(total(flow.sources)).toBe(flow.totalCents);
      expect(total(flow.targets)).toBe(flow.totalCents);
    }
  });
});
