import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { MoneyFlow as Flow } from "@/insights/server";
import { bookingsHref, type BookingsFilter } from "@/app/_lib/bookings-href";
import { formatEuro } from "@/shared/money";
import { useCategoryName } from "@/transactions";
import { layoutFlow } from "./money-flow-layout";

type Source = Flow["sources"][number];
type Target = Flow["targets"][number];
type Kind = Source["kind"] | Target["kind"];

/**
 * Colour per node kind (daisyUI theme tokens, so light and dark mode both work). Categories share
 * one colour: their names tell them apart. A shortfall is a warning and wears the error colour.
 */
const COLOR: Record<Kind, string> = {
  income: "var(--color-primary)",
  refunds: "var(--color-info)",
  fromSavings: "var(--color-accent)",
  fromShared: "var(--color-info)",
  shortfall: "var(--color-error)",
  category: "var(--color-secondary)",
  otherCategories: "var(--color-secondary)",
  uncategorized: "color-mix(in oklab, var(--color-base-content) 45%, transparent)",
  saving: "var(--color-accent)",
  toShared: "var(--color-info)",
  left: "var(--color-primary)",
};

/** Width of a node bar (px). */
const BAR = 8;

/**
 * The month's money flow as a Sankey chart: sources on the left flow into one bar in the middle,
 * which flows out to the categories, saving and what is left over. Band width is the amount.
 * Each node with bookings behind it links to them.
 */
export function MoneyFlow({
  flow,
  account,
  categoryNames,
}: {
  flow: Flow;
  /** An account id or "all". */
  account: string;
  /** Names of own categories (the page's catalog). */
  categoryNames: Record<string, string>;
}) {
  const t = useTranslations("app.statistics");
  const uncategorized = useTranslations("transactions.spending")("uncategorized");
  const categoryName = useCategoryName(categoryNames);
  const format = useFormatter();
  const monthName = format.dateTime(new Date(`${flow.month}-01T00:00:00Z`), { month: "long", timeZone: "UTC" });

  const name = (node: Source | Target) =>
    node.kind === "category" ? categoryName(node.group) : node.kind === "uncategorized" ? uncategorized : t(`flow.${node.kind}`);
  const filter = (node: Source | Target): Omit<BookingsFilter, "account" | "month"> | null => {
    switch (node.kind) {
      case "income":
        return { kind: "income" };
      case "saving":
        return { kind: "saving" };
      case "category":
        return { kind: "expense", category: node.group };
      case "uncategorized":
        return { kind: "expense", category: null };
      case "otherCategories":
        return { kind: "expense" };
      default:
        return null;
    }
  };
  const href = (node: Source | Target) => {
    const f = filter(node);
    return f ? bookingsHref({ account, month: flow.month, ...f }) : null;
  };
  const share = (cents: number) => t("share", { percent: Math.round((cents * 100) / flow.totalCents) });

  if (flow.totalCents === 0) {
    return (
      <section className="flex flex-col gap-3 border-t border-base-300 pt-5">
        <h2 className="text-lg font-semibold">{t("flow.title", { month: monthName })}</h2>
        <p className="text-sm text-base-content/60">{t("flow.empty")}</p>
      </section>
    );
  }

  const layout = layoutFlow(flow);
  const summary = [
    ...flow.sources.map((n) => `${name(n)} ${formatEuro(n.cents)}`),
    ...flow.targets.map((n) => `${name(n)} ${formatEuro(n.cents)}`),
  ].join(", ");

  const label = (node: Source | Target, labelY: number, side: "left" | "right") => {
    const link = href(node);
    const text = name(node);
    return (
      <div
        key={`${node.kind}-${"group" in node ? node.group : ""}`}
        className={`absolute flex w-full -translate-y-1/2 flex-col leading-tight ${side === "left" ? "items-end pr-2 text-right" : "items-start pl-2"}`}
        style={{ top: labelY }}
      >
        <span className="max-w-full truncate text-xs text-base-content/70">
          {link ? (
            <Link href={link} className="link link-hover">
              {text}
            </Link>
          ) : (
            text
          )}
        </span>
        <span className="text-sm font-medium tabular-nums">{formatEuro(node.cents)}</span>
      </div>
    );
  };

  return (
    <section className="flex min-w-0 flex-col gap-3 border-t border-base-300 pt-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold">{t("flow.title", { month: monthName })}</h2>
        <p className="text-sm text-base-content/60">{t("flow.hint")}</p>
      </div>
      <figure className="m-0">
        <div className="grid grid-cols-[5.5rem_1fr_8.5rem] sm:grid-cols-[8rem_1fr_11rem]" style={{ height: layout.height }}>
          <div className="relative">{layout.sources.map((s) => label(s.node, s.labelY, "left"))}</div>
          <div className="relative" role="img" aria-label={t("flow.label", { month: monthName, summary })}>
            <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 100 ${layout.height}`} preserveAspectRatio="none" aria-hidden>
              {layout.bands.map((band) => {
                const node = band.side === "source" ? layout.sources[band.index].node : layout.targets[band.index].node;
                return (
                  <path
                    key={`${band.side}-${band.index}`}
                    d={band.d}
                    fill={COLOR[node.kind]}
                    className="opacity-25 transition-opacity hover:opacity-50"
                  >
                    <title>{`${name(node)}: ${formatEuro(node.cents)} (${share(node.cents)})`}</title>
                  </path>
                );
              })}
            </svg>
            {/* Bars as HTML so they keep their width in pixels while the bands stretch. */}
            {layout.sources.map((s, i) => (
              <span key={`s${i}`} className="absolute left-0 rounded-sm" style={{ top: s.y, height: s.height, width: BAR, background: COLOR[s.node.kind] }} />
            ))}
            <span
              className="absolute left-1/2 -translate-x-1/2 rounded-sm bg-base-content/70"
              style={{ top: layout.middle.y, height: layout.middle.height, width: BAR }}
              title={`${t("flow.middle")}: ${formatEuro(flow.totalCents)}`}
            />
            {layout.targets.map((tg, i) => (
              <span key={`t${i}`} className="absolute right-0 rounded-sm" style={{ top: tg.y, height: tg.height, width: BAR, background: COLOR[tg.node.kind] }} />
            ))}
          </div>
          <div className="relative">{layout.targets.map((tg) => label(tg.node, tg.labelY, "right"))}</div>
        </div>
        <figcaption className="mt-2 text-center text-xs text-base-content/60">
          {t("flow.middle")}: <span className="font-medium text-base-content tabular-nums">{formatEuro(flow.totalCents)}</span>
        </figcaption>
      </figure>
    </section>
  );
}
