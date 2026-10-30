import { describe, expect, it } from "vitest";
import type { MoneyFlow } from "@/insights/server";
import { LABEL_HEIGHT, layoutFlow, NODE_GAP } from "./money-flow-layout";

const flow = (sources: number[], targets: number[]): MoneyFlow => ({
  month: "2026-10",
  totalCents: sources.reduce((a, b) => a + b, 0),
  sources: sources.map((cents) => ({ kind: "income", group: null, cents })),
  targets: targets.map((cents, i) => ({ kind: "category", group: `g${i}`, cents })),
});

describe("flow layout", () => {
  it("gives the middle bar the whole amount and both sides the same scale", () => {
    const layout = layoutFlow(flow([100000], [60000, 30000, 10000]));
    const targetsHeight = layout.targets.reduce((sum, t) => sum + t.height, 0);
    expect(layout.sources[0].height).toBeCloseTo(layout.middle.height);
    expect(targetsHeight).toBeCloseTo(layout.middle.height);
    // Nodes at least NODE_GAP apart, inside the chart, each label at its bar's middle.
    layout.targets.slice(1).forEach((t, i) => expect(t.y - layout.targets[i].y - layout.targets[i].height).toBeGreaterThanOrEqual(NODE_GAP - 1e-9));
    layout.targets.forEach((t) => expect(t.labelY).toBeCloseTo(t.y + t.height / 2));
    expect(layout.targets[0].y).toBeGreaterThanOrEqual(0);
    expect(layout.targets[2].y + layout.targets[2].height).toBeLessThanOrEqual(layout.height);
    expect(layout.bands).toHaveLength(4);
  });

  it("keeps the order of the nodes and is tall enough for every label", () => {
    const layout = layoutFlow(flow([100], [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]));
    expect(layout.height).toBeGreaterThanOrEqual(10 * LABEL_HEIGHT);
    const ys = layout.targets.map((t) => t.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    const labels = layout.targets.map((t) => t.labelY);
    labels.slice(1).forEach((y, i) => expect(y - labels[i]).toBeGreaterThanOrEqual(LABEL_HEIGHT - 1e-9));
  });

  it("draws tiny amounts at least 2 px high", () => {
    const layout = layoutFlow(flow([1000000], [999999, 1]));
    expect(layout.targets[1].height).toBe(2);
  });

  it("draws nothing for an empty month", () => {
    expect(layoutFlow(flow([], []))).toMatchObject({ sources: [], targets: [], bands: [], middle: { height: 0 } });
  });
});
