# Einnahmen nach Kategorie im Geldfluss, Beitrag Gemeinschaftskonto entfernen

## Ziel

1. Der Geldfluss-Chart der Statistik zeigt links die Einnahmen aufgeteilt nach Kategoriegruppe
   (Gehalt, Zinsen & Dividenden, Sonstige Einnahmen, eigene Einnahmekategorien, ohne Kategorie)
   statt eines einzigen Knotens „Einnahmen". Jeder Knoten verlinkt auf die gefilterten Buchungen.
2. „Beitrag Gemeinschaftskonto" verschwindet überall (Dashboard, Statistik-Kacheln, Monatsliste,
   Jahresübersicht, Geldfluss-Knoten „Gemeinschaftskonto"). Grund: Überweisungen aufs
   Gemeinschaftskonto bucht der Nutzer jetzt als Ausgabe (Kategorie Miete). Rückflüsse kommen nicht vor.
   „Verfügbar" für „Alle privaten Konten" ist dann einfach Einnahmen − Ausgaben − Sparen.

## Entscheidungen

- Einnahmen pro Gruppe kommen aus einer neuen Methode `categoryIncomes` in transactions
  (`BookingFigures`), gebaut wie `categorySpendings`: nur Buchungen der Art Einnahme, gruppiert
  nach Kategoriegruppe, positive Cents, Gruppen ≤ 0 fallen weg, `group: null` = ohne Kategorie.
- `FlowSource` „income" bekommt `group: string | null`; mehrere Einnahme-Knoten, größte zuerst,
  dann ohne Kategorie. Erstattungen, aus Sparen und Fehlbetrag bleiben.
- Die Lücke-Logik bleibt: beide Seiten sind immer gleich groß (Rest → „Übrig" oder „Fehlbetrag").
- Beitrag-Logik wird komplett entfernt: `contributionCents` aus insights' Typen, `fromShared` /
  `toShared` aus dem Geldfluss, `sharedContribution(s)` aus transfers (danach ungenutzt).
  insights hängt dann nicht mehr von transfers ab; die Regel insights → transfers wird gestrichen.

## Schritte

1. transactions: `categoryIncomes(caller, target, count, until)` in Contract + `booking-figures.ts`, Test.
2. transfers: `sharedContribution`, `sharedContributions`, ihre Typen und Tests entfernen.
3. insights: `statisticsRows` ohne Beiträge, `yearTotals` ohne Beitrag, `MonthFigures` ohne Beitrag,
   `moneyFlow(row, spendings, incomes)` mit Einnahmen pro Gruppe; `createInsights` ohne transfers,
   mit `categoryIncomes`. Tests anpassen.
4. app: `_lib/insights.ts` ohne transfers; Dashboard, Statistik, Jahresseite ohne Beitrag;
   `money-flow.tsx` mit Kategorienamen und Links für Einnahme-Knoten; Texte in de/en aufräumen.
5. Regel insights → transfers streichen (`change-map forbid insights transfers`), CLAUDE.md anpassen.
6. `npm test`, Lint, Typecheck, im Browser prüfen.

## Change manifest

```change-manifest
version: 1
title: Income by category in the money flow
slug: income-flow-categories
summary: The money flow chart on the statistics page splits income by category, such as salary, interest and other income. The separate "shared account contribution" figure disappears everywhere. Everything else on the statistics page and the dashboard stays the same.
why: The user wants to see where income comes from. Payments to the shared account are now booked as an expense, so the extra contribution figure would count them twice or confuse.
unchanged: Single accounts look the same except for the split income in the chart. Bookings, budgets, rules, imports and transfer matching do not change.
steps:
  - title: Income totals per category
    text: The bookings part gets a new figure. It sums a month's income per category group.
    units: [transactions]
  - title: Split income in the money flow
    text: The statistics figures use the new income totals. The chart shows one income node per category, each linking to its bookings.
    units: [insights, transactions, app]
  - title: Remove the shared account contribution
    text: The contribution figure leaves the dashboard, the statistics page and the year overview. The transfers part no longer computes it.
    units: [insights, transfers, app]
    before: ["insights → transfers"]
    after: ["insights no longer uses transfers"]
files:
  - path: src/transactions/contract.ts
    change: changed
    purpose: Describe the new income-per-category figure.
  - path: src/transactions/booking-figures.ts
    change: changed
    purpose: Sum a month's income per category group.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Test the income-per-category figure.
  - path: src/transfers/contract.ts
    change: changed
    purpose: Drop the shared contribution methods.
  - path: src/transfers/create-transfers.ts
    change: changed
    purpose: Drop the shared contribution computation.
  - path: src/transfers/create-transfers.test.ts
    change: changed
    purpose: Drop the shared contribution tests.
  - path: src/insights/contract.ts
    change: changed
    purpose: Remove the contribution from the month figures.
  - path: src/insights/statistics.ts
    change: changed
    purpose: Statistics rows without the contribution.
  - path: src/insights/statistics.test.ts
    change: changed
    purpose: Tests without the contribution.
  - path: src/insights/year-overview.ts
    change: changed
    purpose: Year totals without the contribution.
  - path: src/insights/year-overview.test.ts
    change: changed
    purpose: Tests without the contribution.
  - path: src/insights/money-flow.ts
    change: changed
    purpose: One income source per category group, no shared account nodes.
  - path: src/insights/money-flow.test.ts
    change: changed
    purpose: Test the split income and the removed nodes.
  - path: src/insights/create-insights.ts
    change: changed
    purpose: Use the income totals and stop using transfers.
  - path: src/insights/create-insights.test.ts
    change: changed
    purpose: Tests with income totals and without transfers.
  - path: src/app/_lib/insights.ts
    change: changed
    purpose: Create insights without transfers.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: Dashboard without the contribution tile.
  - path: src/app/[locale]/statistics/page.tsx
    change: changed
    purpose: Statistics tiles and month list without the contribution.
  - path: src/app/[locale]/statistics/money-flow.tsx
    change: changed
    purpose: Name and link each income node by its category.
  - path: src/app/[locale]/statistics/year/page.tsx
    change: changed
    purpose: Year overview without the contribution column.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: Remove the contribution texts.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: Remove the contribution texts.
  - path: eslint.boundaries.mjs
    change: changed
    purpose: Insights may no longer import transfers.
  - path: CLAUDE.md
    change: changed
    purpose: Architecture line for insights without transfers.
signoff:
  - kind: edge-remove
    subject: { from: insights, to: transfers }
    reason: Insights only used transfers for the contribution figure. That figure goes away. Forbidding the dependency keeps the parts simpler.
    plain: The statistics part will no longer be allowed to use the transfers part.
removedEdges:
  - { from: insights, to: transfers, plain: The statistics part stops using the transfers part. }
amendments:
  - id: A1
    at: 2026-10-30T12:34:34Z
    on: file
    action: remove
    target: eslint.boundaries.mjs
    reason: The dependency rules live in architecture.json. The eslint file only reads them.
  - id: A2
    at: 2026-10-30T12:34:34Z
    on: file
    action: add
    item:
      path: architecture.json
      change: changed
      purpose: Insights may no longer use transfers.
    reason: This is where change-map forbid removed the rule.
  - id: A3
    at: 2026-10-30T12:34:34Z
    on: file
    action: add
    item:
      path: src/app/[locale]/statistics/money-flow-layout.test.ts
      change: changed
      purpose: Test data gives income nodes a category group.
    reason: Income sources now carry a group, so the chart layout test data needed it.
  - id: A4
    at: 2026-10-30T12:34:34Z
    on: file
    action: add
    item:
      path: src/rules/components/rule-form.tsx
      change: changed
      purpose: The user's own edit from before this change, not part of it.
    reason: This file was already changed before the work started. It was left untouched.
```
