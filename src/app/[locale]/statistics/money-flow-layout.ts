// Geometry of the money flow chart (pure): sources on the left flow into one middle bar, which
// flows out to the targets on the right. Heights are in pixels; x runs from 0 (left edge) to 100
// (right edge), so the SVG stretches to any width while bands keep their thickness.

import type { MoneyFlow } from "@/insights/server";

/** Space between two nodes in a column (px). */
export const NODE_GAP = 8;

/** The least room a label needs (two lines: name and amount, px). */
export const LABEL_HEIGHT = 40;

/** Share of the room for labels that the bars take; the rest is space between nodes. */
const BAR_SHARE = 0.6;

/** The least height of the chart (px). */
const MIN_HEIGHT = 200;

/** Thinnest drawn node (px), so a tiny amount stays visible. */
const MIN_NODE = 2;

export type PlacedNode<T> = {
  node: T;
  /** Top of the bar and its height (px). */
  y: number;
  height: number;
  /** Vertical middle of the node and its label (px). */
  labelY: number;
};

export type Band = {
  /** Which end the band belongs to: a source (into the middle) or a target (out of it). */
  side: "source" | "target";
  /** Index in sources or targets. */
  index: number;
  /** SVG path in the chart's coordinates (x 0–100, y px). */
  d: string;
};

export type FlowLayout = {
  height: number;
  sources: PlacedNode<MoneyFlow["sources"][number]>[];
  middle: { y: number; height: number };
  targets: PlacedNode<MoneyFlow["targets"][number]>[];
  bands: Band[];
};

/** A band from x0 (y0top…y0top+thickness) to x1 (y1top…), as a filled shape with curved sides. */
function bandPath(x0: number, y0: number, x1: number, y1: number, thickness: number): string {
  const mid = (x0 + x1) / 2;
  const n = (v: number) => Math.round(v * 100) / 100;
  return [
    `M${n(x0)},${n(y0)}`,
    `C${n(mid)},${n(y0)} ${n(mid)},${n(y1)} ${n(x1)},${n(y1)}`,
    `L${n(x1)},${n(y1 + thickness)}`,
    `C${n(mid)},${n(y1 + thickness)} ${n(mid)},${n(y0 + thickness)} ${n(x0)},${n(y0 + thickness)}`,
    "Z",
  ].join(" ");
}

/**
 * Places the flow's nodes and bands. Both sides use the same scale, so band widths match on both
 * ends. Nodes in a column are at least NODE_GAP apart and their middles at least LABEL_HEIGHT
 * apart, so each label sits right next to its bar. The chart grows to the taller column.
 */
export function layoutFlow(flow: MoneyFlow): FlowLayout {
  const count = Math.max(flow.sources.length, flow.targets.length, 1);
  const barsHeight = Math.max(MIN_HEIGHT, count * LABEL_HEIGHT) * BAR_SHARE;
  const scale = flow.totalCents > 0 ? barsHeight / flow.totalCents : 0;
  const thickness = (cents: number) => Math.max(MIN_NODE, cents * scale);

  /** One column from y = 0, each node below the one before; returns the nodes and its extent. */
  function pack<T extends { cents: number }>(nodes: T[]) {
    const placed: PlacedNode<T>[] = [];
    for (const node of nodes) {
      const h = thickness(node.cents);
      const before = placed.at(-1);
      const y = before ? Math.max(before.y + before.height + NODE_GAP, before.labelY + LABEL_HEIGHT - h / 2) : Math.max(0, LABEL_HEIGHT / 2 - h / 2);
      placed.push({ node, y, height: h, labelY: y + h / 2 });
    }
    const last = placed.at(-1);
    const extent = last ? Math.max(last.y + last.height, last.labelY + LABEL_HEIGHT / 2) : 0;
    return { placed, extent };
  }

  const left = pack(flow.sources);
  const right = pack(flow.targets);
  const height = Math.max(MIN_HEIGHT, left.extent, right.extent);
  /** Moves a packed column to the vertical middle. */
  const centre = <T>({ placed, extent }: { placed: PlacedNode<T>[]; extent: number }) => {
    const shift = (height - extent) / 2;
    return placed.map((p) => ({ ...p, y: p.y + shift, labelY: p.labelY + shift }));
  };
  const sources = centre(left);
  const targets = centre(right);
  const middleHeight = flow.totalCents * scale;
  const middle = { y: (height - middleHeight) / 2, height: middleHeight };

  const bands: Band[] = [];
  let into = middle.y;
  sources.forEach((s, index) => {
    const h = s.node.cents * scale;
    bands.push({ side: "source", index, d: bandPath(0, s.y, 50, into, h) });
    into += h;
  });
  let out = middle.y;
  targets.forEach((t, index) => {
    const h = t.node.cents * scale;
    bands.push({ side: "target", index, d: bandPath(50, out, 100, t.y, h) });
    out += h;
  });

  return { height, sources, middle, targets, bands };
}
