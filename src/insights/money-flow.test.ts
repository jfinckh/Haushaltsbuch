import { describe, expect, it } from "vitest";
import { moneyFlow } from "./money-flow";
import { statisticsRows } from "./statistics";

const row = (incomeCents: number, expenseCents: number, savingCents: number, contributionCents?: number) =>
  statisticsRows(
    [{ month: "2026-10", incomeCents, expenseCents, savingCents, availableCents: incomeCents + expenseCents + savingCents }],
    contributionCents === undefined ? undefined : [{ month: "2026-10", cents: contributionCents }],
  )[0];

const total = (nodes: { cents: number }[]) => nodes.reduce((sum, n) => sum + n.cents, 0);

describe("money flow", () => {
  it("sends income to categories, saving and what is left over", () => {
    const flow = moneyFlow(row(200000, -50000, -25000), [
      { group: "groceries", cents: 30000 },
      { group: "housing", cents: 20000 },
    ]);
    expect(flow).toEqual({
      month: "2026-10",
      totalCents: 200000,
      sources: [{ kind: "income", cents: 200000 }],
      targets: [
        { kind: "category", group: "groceries", cents: 30000 },
        { kind: "category", group: "housing", cents: 20000 },
        { kind: "saving", cents: 25000 },
        // Equal to the row's available amount.
        { kind: "left", cents: 125000 },
      ],
    });
  });

  it("adds a shortfall when more went out than came in", () => {
    const flow = moneyFlow(row(100000, -150000, 0), [{ group: "housing", cents: 150000 }]);
    expect(flow.sources).toEqual([
      { kind: "income", cents: 100000 },
      { kind: "shortfall", cents: 50000 },
    ]);
    expect(flow.targets).toEqual([{ kind: "category", group: "housing", cents: 150000 }]);
    expect(flow.totalCents).toBe(150000);
  });

  it("shows refunds larger than their group and saving taken out as sources", () => {
    // Groceries 300 €, shopping refunded 50 € more than spent (left out by categorySpendings): 250 € spent.
    const flow = moneyFlow(row(0, -25000, 40000), [{ group: "groceries", cents: 30000 }]);
    expect(flow.sources).toEqual([
      { kind: "refunds", cents: 5000 },
      { kind: "fromSavings", cents: 40000 },
    ]);
    expect(flow.targets).toEqual([
      { kind: "category", group: "groceries", cents: 30000 },
      { kind: "left", cents: 15000 },
    ]);
  });

  it("shows the contribution to shared accounts both ways", () => {
    const paid = moneyFlow(row(200000, 0, 0, -80000), []);
    expect(paid.targets).toEqual([
      { kind: "toShared", cents: 80000 },
      { kind: "left", cents: 120000 },
    ]);
    const back = moneyFlow(row(0, 0, 0, 10000), []);
    expect(back.sources).toEqual([{ kind: "fromShared", cents: 10000 }]);
    expect(back.targets).toEqual([{ kind: "left", cents: 10000 }]);
  });

  it("merges the groups after the 7 largest and keeps uncategorized spending apart", () => {
    const groups = [
      { group: null, cents: 900 },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ group: `g${n}`, cents: n * 1000 })),
    ];
    const spent = total(groups);
    const flow = moneyFlow(row(spent, -spent, 0), groups);
    expect(flow.targets.map((t) => (t.kind === "category" ? t.group : t.kind))).toEqual([
      "g9", "g8", "g7", "g6", "g5", "g4", "g3", "otherCategories", "uncategorized",
    ]);
    expect(flow.targets.find((t) => t.kind === "otherCategories")?.cents).toBe(3000);
  });

  it("is empty for a month without bookings", () => {
    expect(moneyFlow(row(0, 0, 0), [])).toEqual({ month: "2026-10", totalCents: 0, sources: [], targets: [] });
  });

  it("always has equal sides", () => {
    const cases = [
      moneyFlow(row(123456, -98765, -4321, -20000), [{ group: "a", cents: 50000 }, { group: null, cents: 48765 }]),
      moneyFlow(row(1000, -98765, 5000, 3000), [{ group: "a", cents: 100000 }]),
      moneyFlow(row(-5000, -1000, 0), [{ group: "a", cents: 1000 }]),
    ];
    for (const flow of cases) {
      expect(total(flow.sources)).toBe(flow.totalCents);
      expect(total(flow.targets)).toBe(flow.totalCents);
    }
  });
});
