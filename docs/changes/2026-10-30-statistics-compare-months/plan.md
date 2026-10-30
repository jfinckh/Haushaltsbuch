# Statistik: bis zu 3 Monate vergleichen

## Ziel

Die Monatsstatistik bleibt wie sie ist. Zusätzlich kann man bis zu 2 weitere Monate frei dazuwählen
(z. B. Okt 2026 + Sep 2026 + Okt 2025). Dann zeigt jeder Bereich alle gewählten Monate direkt
untereinander, zum Vergleichen.

## Entscheidungen (mit dir abgestimmt)

- **Auswahl:** frei, bis 3 Monate insgesamt. Der Monatswähler bleibt der Hauptmonat (Pfeile, Listen).
  Darunter Chips der Vergleichsmonate mit ×, und „+ Monat vergleichen" (Monat- und Jahresliste).
  Adresse: `?account=…&month=2026-10&compare=2026-09,2025-10`. Ohne `compare` alles wie heute.
- **Kacheln:** die Kachelreihe pro Monat wiederholt, jede mit Monatsname als Überschrift, jede mit
  ihren eigenen Pfeilen (vs. Vormonat, vs. üblich), wie heute.
- **Kategorien:** pro Kategoriegruppe 3 dünne Balken untereinander, je mit Monat, Betrag und Anteil.
  Gleicher Maßstab für alle Balken (größter Betrag = voller Balken). Gruppen: alle aus allen gewählten
  Monaten, sortiert nach Betrag im Hauptmonat. Der Hinweis „mehr/weniger als üblich" fällt im
  Vergleich weg. Ein Monat: wie heute.
- **Geldfluss:** 3 Diagramme untereinander, jedes mit Monatsname.
- **Verlauf (12 Monate):** bleibt wie heute (bis Hauptmonat). Gewählte Monate hervorgehoben.
  Klick auf einen Monat macht ihn zum Hauptmonat, Vergleich bleibt.
- **Reihenfolge:** alle Bereiche zeigen die Monate neuester zuerst.
- Ungültige, doppelte oder zukünftige Vergleichsmonate werden still ignoriert; mehr als 2 abgeschnitten.

## Was gleich bleibt

Insights-Teil, Datenbank, API, Datenschutz: keine Änderung. Die Seite ruft die vorhandenen
Insights-Funktionen pro Monat einmal auf (bis 3× parallel). Konten-Sichtbarkeit wie bisher.
Jahresansicht unverändert.

## Dateien

- `src/app/[locale]/statistics/compare-months.ts` (neu): `chosenCompare()` liest `?compare`,
  `statisticsHref()` baut Links mit account, month, compare; `shownMonths()` sortiert neuester zuerst.
- `src/app/[locale]/statistics/compare-months.test.ts` (neu): Tests dafür.
- `src/app/[locale]/statistics/compare-picker.tsx` (neu, Client): Chips + „Monat vergleichen".
- `src/app/[locale]/statistics/category-compare.tsx` (neu): Kategorien mit 3 Balken pro Gruppe.
- `src/app/[locale]/statistics/page.tsx` (geändert): pro Monat Kacheln + Geldfluss, Vergleichskategorien,
  Hervorhebung im Verlauf, compare in Links.
- `src/app/[locale]/statistics/month-switcher.tsx`, `month-picker.tsx` (geändert): compare in Links behalten.
- `src/app/_lib/messages/de.json`, `en.json` (geändert): neue Texte unter `statistics`.

## Schritte

1. `compare-months.ts` + Tests (TDD).
2. Picker-Komponente, Links in Switcher/Picker/Kontowahl/Verlauf.
3. Kacheln und Geldfluss pro Monat.
4. `category-compare.tsx`.
5. Texte de/en, Lint, Typecheck, Tests, im Browser prüfen (1, 2, 3 Monate, Handy-Breite).

## Change manifest

```change-manifest
version: 1
title: Compare statistics months
slug: statistics-compare-months
summary: On the statistics page you can add up to two more months to the chosen one. Every section then shows all chosen months one below the other. Without extra months the page looks as before.
why: You want to compare months directly, for example this month with last month and the same month last year.
unchanged: The figures, the database, the API and who may see which account stay the same. The year view does not change.
steps:
  - title: Read and keep the chosen months
    text: The page reads the extra months from the address and keeps them in every link on the page.
    units: [app]
  - title: Show each section for every chosen month
    text: The figure tiles and the money flow chart repeat per month. The categories show one bar per month for each group.
    units: [app]
files:
  - path: src/app/[locale]/statistics/compare-months.ts
    change: new
    purpose: Reads the extra months from the address and builds the page links.
  - path: src/app/[locale]/statistics/compare-months.test.ts
    change: new
    purpose: Tests for reading the months and building the links.
  - path: src/app/[locale]/statistics/compare-picker.tsx
    change: new
    purpose: Lets you add and remove months to compare.
  - path: src/app/[locale]/statistics/category-compare.tsx
    change: new
    purpose: Shows spending per category group with one bar per chosen month.
  - path: src/app/[locale]/statistics/page.tsx
    change: changed
    purpose: Shows tiles and money flow per chosen month and highlights them in the history.
  - path: src/app/[locale]/statistics/month-switcher.tsx
    change: changed
    purpose: Keeps the extra months when you switch the main month.
  - path: src/app/[locale]/statistics/month-picker.tsx
    change: changed
    purpose: Keeps the extra months when you pick the main month from the lists.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts for comparing months.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts for comparing months.
signoff: []
amendments:
  - id: A1
    at: 2026-10-30T12:47:27Z
    on: file
    action: add
    item:
      path: src/app/[locale]/statistics/money-flow.tsx
      change: changed
      purpose: The money flow title can name the year as well.
    reason: When October 2025 and October 2026 are compared, a title with only the month would look the same twice.
```
