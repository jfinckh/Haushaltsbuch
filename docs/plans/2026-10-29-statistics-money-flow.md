# Statistics: money flow, "left over" and comparisons

Goal: the statistics page answers at a glance, per account or for "Alle privaten Konten" and for the
chosen month: how much came in, went out, was saved, what is left over, where the money went, and
how the month compares with the month before and with the usual.

Today the page has tiles for spending, income, saved and savings rate, a category list and the
12-month history. Missing: "left over" (computed but not shown), a chart of where the money goes,
and comparisons for all figures (only spending and savings rate against the previous month, and
categories against their 3-month average).

## What the user sees

Order on the page (top to bottom): account switcher, month switcher, tiles, money flow, category
list, history.

1. **Tiles:** Einnahmen, Ausgaben, Gespart, **Übrig**, Sparquote (and Beitrag Gemeinschaftskonto for
   "Alle privaten Konten", as now). Each tile with a figure in euros gets two short lines:
   - against the previous month: "↑ 120 € mehr als Oktober"
   - against the usual: "↓ 80 € weniger als üblich (Ø 1.234 €)"
   Colour says good or bad: more income, saved or left over is good; more spending is bad.
   Small differences (below 10 € or 10 % of the other value, the rule the category list already
   uses) show "≈ wie Oktober" / "≈ wie üblich" in grey. Savings rate: difference in percentage
   points, "same" below 0.5 points.
2. **Running month:** when the chosen month is the current one, a short hint under the tiles:
   "Der Monat läuft noch, Stand heute." A half month otherwise always looks cheaper than usual.
3. **Money flow (Sankey):** one chart for the chosen month. Left: where money came from. Middle:
   one bar "Geld im Monat". Right: where it went. Band width = amount.
   - Left (sources): Einnahmen; Erstattungen (category groups where refunds were larger than
     spending); Aus Sparkonten (saving that was taken out, net); Vom Gemeinschaftskonto (only
     "Alle privaten Konten", when money came back); Fehlbetrag (when more went out than came in,
     i.e. paid from the balance).
   - Right (targets): the category groups, largest first (at most 7, the rest as "Weitere
     Kategorien"); Ohne Kategorie; Gespart; An Gemeinschaftskonto ("Alle privaten Konten");
     Übrig.
   - Both sides always add up to the same total, and "Übrig" equals the Übrig tile.
   - Each category band links to that month's bookings of the group (as the category list does);
     Gespart and Einnahmen link to their bookings too.
   - No data in the month: a short line "Keine Buchungen in diesem Monat" instead of the chart.
   - Drawn as plain SVG, no chart library. Colours from the daisyUI theme, so light and dark mode
     both work. Labels with amounts sit next to the bars. On phones the chart keeps its proportions
     and labels stay readable (min. node height, labels outside the bars). The SVG gets an
     accessible label; the numbers are also in the tiles and the category list.
4. **History:** each month row also shows "Übrig".

## How

### insights (figures, pure, tested)

1. **`src/insights/statistics.ts`**: replace `compareMonths` with `compareFigures(current, other)`:
   per figure (income, spending, saved, left over) a difference `{ direction, cents }`, using the
   existing `usualDifference` rule from category-trends; savings rate change in points with
   direction. New `averageRow(rows)`: the usual month = average of up to 3 months before the chosen
   month that have bookings (months without any income or spending, e.g. before the first import,
   are skipped, so they don't pull the average down); null when there is none. Result carries how
   many months were averaged.
2. **`src/insights/money-flow.ts`** (new): `moneyFlow(row, groups)` builds sources and targets
   from the month's statistics row and its category spending (as `categorySpendings` returns it).
   Groups beyond the 7 largest are merged. Fills the gap with Fehlbetrag or Übrig, so both sides
   are equal. Pure.
3. **`src/insights/contract.ts`**: `Statistics.comparison` becomes
   `{ previous: FigureChanges | null; usual: (FigureChanges & { months: number; row: averages }) | null }`,
   plus `running: boolean` (chosen month is the current one). New method
   `moneyFlow(caller, target, month?)` returning `MoneyFlowResult`; types `MoneyFlow`,
   `StatisticsComparison`.
4. **`src/insights/create-insights.ts`**: `statistics` fills comparison and `running`.
   `moneyFlow` loads the month's summary row (as `statistics` with 1 month, incl. contribution for
   "Alle privaten Konten") and `categorySpendings` for 1 month, then calls the pure function. Same
   month checks as the other methods (future month → invalid-input). Sees only what the caller's
   session sees, like the other methods.
5. **`src/insights/server.ts`**: export the types `MoneyFlow` and `StatisticsComparison`.

### app (page)

6. **`src/app/[locale]/statistics/money-flow-layout.ts`** (new): turns a `MoneyFlow` into
   geometry (node rectangles, band paths as cubic curves, label positions) for a fixed viewBox.
   Pure, tested (sides equal height, min. node height, order kept).
7. **`src/app/[locale]/statistics/money-flow.tsx`** (new): server component, renders the SVG with
   links, names via next-intl and `useCategoryName`, amounts via `formatEuro`.
8. **`src/app/[locale]/statistics/page.tsx`**: tiles with Übrig and both comparison lines,
   running-month hint, money flow section, Übrig in the history rows. Loads `insights.moneyFlow`
   in parallel with the rest.
9. **Texts** in `src/app/_lib/messages/de.json` and `en.json` (`app.statistics.*`): left over,
   comparison lines, running hint, flow node names, flow title, empty state.

### Tests

- `statistics.test.ts`: differences and directions, average skipping empty months, no previous /
  no usual month, savings rate points.
- `money-flow.test.ts`: income > spending (Übrig), spending > income (Fehlbetrag), refunds and
  savings taken out as sources, contribution both ways, more than 7 groups merged, empty month;
  sides always equal; Übrig equals the row's available amount when positive.
- `create-insights.test.ts`: `moneyFlow` passes the target and month on, contribution only for
  "Alle privaten Konten", future month invalid; `statistics` comparison and `running`.
- `money-flow-layout.test.ts`: geometry.
- No new API route, so no new privacy route test; all figures come from the caller's session as
  before.
- Then eslint, tsc, vitest; look at the page in the browser (light, dark, phone width).

Nothing to do by hand.

## Change manifest

```change-manifest
version: 1
title: Statistics money flow and comparisons
slug: statistics-money-flow
summary: The statistics page shows what is left over each month, a money flow chart from income to categories, saving and left over, and compares every figure with the month before and with the usual month. Accounts, bookings and the dashboard stay as they are.
why: You want to see at a glance where your money goes and how a month went compared with the last one and with the usual.
unchanged: No new tables, packages or settings. The dashboard, the year view, bookings and privacy rules stay the same. Every figure still comes only from accounts the viewer may see.
steps:
  - title: Compute comparisons and the money flow
    text: The insights part, which computes the statistics figures, adds comparisons with the previous and the usual month. It also builds the money flow of a month.
    units: [insights]
  - title: Show them on the statistics page
    text: The page gets a left-over tile, comparison lines on every tile, the money flow chart and left over in the month list.
    units: [app]
files:
  - path: src/insights/statistics.ts
    change: changed
    purpose: Compare a month with the previous month and with the usual month.
  - path: src/insights/statistics.test.ts
    change: changed
    purpose: Tests for the comparisons and the usual month.
  - path: src/insights/money-flow.ts
    change: new
    purpose: Build a month's money flow from its figures and category spending.
  - path: src/insights/money-flow.test.ts
    change: new
    purpose: Tests for the money flow.
  - path: src/insights/contract.ts
    change: changed
    purpose: New comparison shape, running month flag and the moneyFlow method.
  - path: src/insights/create-insights.ts
    change: changed
    purpose: Fill the comparisons and load a month's money flow.
  - path: src/insights/create-insights.test.ts
    change: changed
    purpose: Tests for the comparisons and moneyFlow.
  - path: src/insights/server.ts
    change: changed
    purpose: Export the money flow and comparison types.
  - path: src/app/[locale]/statistics/money-flow-layout.ts
    change: new
    purpose: Turn a money flow into chart geometry.
  - path: src/app/[locale]/statistics/money-flow-layout.test.ts
    change: new
    purpose: Tests for the chart geometry.
  - path: src/app/[locale]/statistics/money-flow.tsx
    change: new
    purpose: Draw the money flow chart as SVG.
  - path: src/app/[locale]/statistics/page.tsx
    change: changed
    purpose: Left-over tile, comparison lines, running month hint, money flow section.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts for the new figures and the chart.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts for the new figures and the chart.
signoff:
  - kind: export-add
    subject: { unit: insights, name: MoneyFlow, side: server }
    reason: The statistics page draws the chart from it. It holds the sources, the targets and their amounts.
    plain: A description of where a month's money came from and where it went.
  - kind: export-add
    subject: { unit: insights, name: StatisticsComparison, side: server }
    reason: The statistics page shows the comparison lines on the tiles from it.
    plain: How a month differs from the month before and from the usual month.
```
