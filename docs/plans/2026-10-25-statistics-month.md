# Statistik: Monat wählbar, klare Filter, verständliche Kategorien

## Ziel

- Der Filter „Alle meine Konten“ heißt künftig „Alle privaten Konten“ (Dashboard und Statistik). Er fasst wie bisher die eigenen privaten Konten zusammen; nichts an den Zahlen ändert sich.
- Der Konto-Umschalter zeigt private Konten und Gemeinschaftskonten getrennt, je mit kurzer Überschrift („Privat“, „Gemeinsam“).
- Statistik, Tab „Monat“ (vorher „Letzte 12 Monate“): ein Monat ist wählbar (‹ Oktober 2026 ›, Adresse `?month=YYYY-MM`). Die Kacheln zeigen den gewählten Monat im Vergleich zum Vormonat. Die Kategorien zeigen den gewählten Monat. Der Verlauf darunter zeigt die 12 Monate bis zum gewählten Monat.
- „Ausgaben nach Kategorie“: pro Kategorie der Betrag im Monat, ein Balken für den Anteil an den Ausgaben des Monats und ein Satz „62 € mehr als üblich“ / „30 € weniger als üblich“ / „wie üblich“. Üblich = Durchschnitt der 3 Monate vor dem gewählten Monat. Unterschiede unter 10 € oder 10 % zählen als „wie üblich“. Keine Mini-Linie und kein Durchschnitts-Strich mehr.
- Tab „Jahr“ bleibt, nur der Umschalter ändert sich.

## Schritte

1. **insights**: `statistics` und `categoryTrends` bekommen einen optionalen Monat `until` (YYYY-MM, Standard: aktueller Monat), den transactions' `monthSummaries` / `categorySpendings` schon unterstützen. Ein Monat in der Zukunft gibt `invalid-input`. `categoryTrends` liefert pro Gruppe zusätzlich `difference: { direction: "more" | "less" | "same", cents }` gegen den 3-Monats-Durchschnitt (reine Funktion `usualDifference`, getestet). Tests in `category-trends.test.ts` und `create-insights.test.ts`.
2. **Umschalter** (`src/app/_lib/account-switcher.tsx`): zwei Gruppen „Privat“ (mit „Alle privaten Konten“ vorne) und „Gemeinsam“; eine Gruppe ohne Konten entfällt. Texte in `app.home` (`allMine` → „Alle privaten Konten“, neu `groupPrivate`, `groupShared`).
3. **Monatswähler**: neue Komponente `src/app/[locale]/statistics/month-switcher.tsx` (‹ Vormonat · Monatsname · Folgemonat ›, kein Folgemonat nach dem aktuellen). Die Seite liest `?month`, ungültig/zukünftig → aktueller Monat.
4. **Statistikseite** (`page.tsx`): Überschrift der Kacheln = Monatsname, Vergleich mit Vormonat; Kategorien des Monats; Verlauf „Verlauf {from} – {to}“. Tab heißt „Monat“; `view-tabs.tsx` behält den Monat nicht (Jahr hat eigenen Wähler).
5. **Kategorien** (`category-trends.tsx`): neue Darstellung wie oben, mit Untertitel „Verglichen mit dem Durchschnitt {from}–{to}“. Links zu den Buchungen wie bisher (nur bei einem Konto).
6. **Texte** de/en, Konzept (`docs/konzept.md`) auf den neuen Namen anpassen.
7. Prüfen: Tests, Lint, Typecheck, Seite im Browser (Max: Alle privaten Konten, ING Giro, Gemeinschaftskonto; Monat zurückblättern; Handybreite).

## Change manifest

```change-manifest
version: 1
title: Statistik mit Monatswahl
slug: statistics-month
summary: The statistics page lets you pick a month. Its figures, categories and history follow that month. The account filter shows private and shared accounts in separate groups, and "Alle meine Konten" is renamed "Alle privaten Konten". The numbers themselves do not change.
why: The page said "last 12 months" but compared only the current month, and no month could be chosen. The category chart was hard to understand. The old filter name did not say that it covers only private accounts.
unchanged: All figures are computed as before. Privacy rules stay the same. The year view, the budgets and the bookings work as before.
steps:
  - title: Figures for a chosen month
    text: The insights part, which computes the statistics, can now compute them for any past month instead of only the current one. It also says per category whether spending is more, less or about the same as usual.
    units: [insights]
  - title: Clearer account filter
    text: The filter on the dashboard and the statistics page groups accounts into private and shared. The combined view is called "Alle privaten Konten".
    units: [app]
  - title: New month view
    text: The statistics page gets a month picker. Tiles, categories and history follow the chosen month. The category list explains the comparison in words.
    units: [app]
expectedEdges:
  - { from: app, to: insights }
files:
  - path: src/insights/create-insights.ts
    change: changed
    purpose: Statistics and category trends for a chosen month.
  - path: src/insights/category-trends.ts
    change: changed
    purpose: Says per category whether spending is more, less or about the same as usual.
  - path: src/insights/category-trends.test.ts
    change: changed
    purpose: Tests the comparison with the usual spending.
  - path: src/insights/create-insights.test.ts
    change: changed
    purpose: Tests statistics for a chosen month and a month in the future.
  - path: src/insights/select-account.ts
    change: changed
    purpose: Comments use the new name of the combined view.
  - path: src/app/_lib/account-switcher.tsx
    change: changed
    purpose: Shows private and shared accounts in separate groups.
  - path: src/app/[locale]/statistics/page.tsx
    change: changed
    purpose: Month view for the chosen month.
  - path: src/app/[locale]/statistics/month-switcher.tsx
    change: new
    purpose: Previous and next month links around the month name.
  - path: src/app/[locale]/statistics/category-trends.tsx
    change: changed
    purpose: Category list with share bar and comparison in words.
  - path: src/app/[locale]/statistics/view-tabs.tsx
    change: changed
    purpose: Tab is now called "Monat".
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts for the new filter groups, month picker and categories.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts for the new filter groups, month picker and categories.
  - path: docs/konzept.md
    change: changed
    purpose: Uses the new name "Alle privaten Konten".
signoff: []
amendments:
  - id: A1
    at: 2026-10-25T21:37:27Z
    on: file
    action: add
    item:
      path: src/insights/statistics.ts
      change: changed
      purpose: Comments use the new name of the combined view.
    reason: The old name "Alle meine Konten" also appeared in comments here.
  - id: A2
    at: 2026-10-25T21:37:27Z
    on: file
    action: add
    item:
      path: src/insights/year-overview.ts
      change: changed
      purpose: Comments use the new name of the combined view.
    reason: The old name "Alle meine Konten" also appeared in a comment here.
  - id: A3
    at: 2026-10-25T21:38:44Z
    on: file
    action: add
    item:
      path: src/app/api/imports/route.test.ts
      change: changed
      purpose: Fewer standard categories (separate work, not by this plan).
    reason: Parallele Arbeit, nicht Teil dieses Plans.
  - id: A4
    at: 2026-10-25T21:38:44Z
    on: file
    action: add
    item:
      path: src/budgets/create-budgets.test.ts
      change: changed
      purpose: Fewer standard categories (separate work, not by this plan).
    reason: Parallele Arbeit, nicht Teil dieses Plans.
  - id: A5
    at: 2026-10-25T21:38:44Z
    on: file
    action: add
    item:
      path: src/rules/create-rules.test.ts
      change: changed
      purpose: Fewer standard categories (separate work, not by this plan).
    reason: Parallele Arbeit, nicht Teil dieses Plans.
  - id: A6
    at: 2026-10-25T21:38:44Z
    on: file
    action: add
    item:
      path: src/transactions/categories.test.ts
      change: changed
      purpose: Fewer standard categories (separate work, not by this plan).
    reason: Parallele Arbeit, nicht Teil dieses Plans.
  - id: A7
    at: 2026-10-25T21:38:44Z
    on: file
    action: add
    item:
      path: src/transactions/categories.ts
      change: changed
      purpose: Fewer standard categories (separate work, not by this plan).
    reason: Parallele Arbeit, nicht Teil dieses Plans.
  - id: A8
    at: 2026-10-25T21:38:44Z
    on: file
    action: add
    item:
      path: src/transactions/create-categories.test.ts
      change: changed
      purpose: Fewer standard categories (separate work, not by this plan).
    reason: Parallele Arbeit, nicht Teil dieses Plans.
  - id: A9
    at: 2026-10-25T21:38:44Z
    on: file
    action: add
    item:
      path: src/transactions/create-transactions.test.ts
      change: changed
      purpose: Fewer standard categories (separate work, not by this plan).
    reason: Parallele Arbeit, nicht Teil dieses Plans.
  - id: A10
    at: 2026-10-25T21:38:44Z
    on: file
    action: add
    item:
      path: src/transactions/messages/de.json
      change: changed
      purpose: Fewer standard categories (separate work, not by this plan).
    reason: Parallele Arbeit, nicht Teil dieses Plans.
  - id: A11
    at: 2026-10-25T21:38:44Z
    on: file
    action: add
    item:
      path: src/transactions/messages/en.json
      change: changed
      purpose: Fewer standard categories (separate work, not by this plan).
    reason: Parallele Arbeit, nicht Teil dieses Plans.
```
