# Statistik: Monat direkt auswählen

## Ziel

Auf der Statistik-Seite (Tab „Monat“) lässt sich jeder Monat mit zwei Auswahllisten direkt wählen, ohne Monat für Monat zu blättern. Die Pfeile ‹ › für Vor- und Folgemonat bleiben.

## Darstellung

```
‹ Sep      [Oktober ▾] [2026 ▾]      Nov ›
```

- Statt der Überschrift „Oktober 2026“ stehen in der Mitte zwei Auswahllisten: Monat (Januar–Dezember) und Jahr.
- Jahre: das aktuelle Jahr und die 10 Jahre davor, neuestes oben.
- Sobald man einen Wert ändert, lädt die Seite den gewählten Monat (kein extra Button). Konto bleibt gewählt.
- Monate in der Zukunft sind im aktuellen Jahr ausgegraut. Wechselt man im Juli 2026 das Jahr auf 2026 und steht der Monat auf Dezember, zeigt die Seite den aktuellen Monat.
- Beide Listen haben eine Beschriftung für Screenreader („Monat“, „Jahr“).
- Monatsnamen in Deutsch bzw. Englisch über den Formatter.

## Schritte

1. Neue Client-Komponente `src/app/[locale]/statistics/month-picker.tsx` („use client“): zwei `<select>` (daisyUI `select select-sm`), navigiert mit `router.push` auf `/statistics?account=…&month=YYYY-MM`.
2. `month-switcher.tsx`: die Überschrift durch die Auswahl ersetzen; Monatsnamen und Jahresliste auf dem Server berechnen und übergeben.
3. Texte de/en: `year` („Jahr“). `month` („Monat“) gibt es schon.
4. Prüfen: Lint, Typen, Browser (Monat und Jahr wechseln, Zukunft gesperrt, Handybreite).

## Change manifest

```change-manifest
version: 1
title: Statistik Monatsauswahl
slug: statistics-month-picker
summary: On the statistics page you can pick any month directly with two lists, one for the month and one for the year. The arrows for the previous and next month stay.
why: Going back many months took many clicks.
unchanged: All figures stay the same. The year view, the dashboard and the account filter work as before.
steps:
  - title: Month and year lists
    text: The month name in the middle of the statistics page becomes two lists. Choosing a value loads that month at once.
    units: [app]
files:
  - path: src/app/[locale]/statistics/month-picker.tsx
    change: new
    purpose: Two lists for month and year that load the chosen month.
  - path: src/app/[locale]/statistics/month-switcher.tsx
    change: changed
    purpose: Shows the lists between the arrows instead of the month name.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German label for the year list.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English label for the year list.
signoff: []
amendments:
  - id: A1
    at: 2026-10-25T21:48:15Z
    on: file
    action: add
    item:
      path: docs/superpowers/plans/2026-10-25-zero-trust-login-cloudflare-access-generic.md
      change: new
      purpose: Plan of a separate login change (not by this plan).
    reason: Parallele Arbeit, nicht Teil dieses Plans.
```
