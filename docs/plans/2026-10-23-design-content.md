# Design, Teil 2: Buchungsliste, Badges, Formulare, Filter

## Ziel

Teil 1 (`2026-10-23-design-shell`) hat Theme, Navigation und Seitenrahmen gebracht. Die Inhalte der einzelnen Teile sehen noch nach daisyUI-Standard aus: gelbe Pillen für „Ohne Kategorie“, drei verschiedene Badge-Stile pro Konto, dicke Fortschrittsbalken, graue Klappboxen, Filter als Stapel. Teil 2 bringt sie in denselben ruhigen Stil.

## Entscheidungen (meine; User hat „Buchungsliste, Badges, Formulare, Filter im neuen Stil“ freigegeben)

- **Global im Theme statt in jeder Datei** (`globals.css`, `@layer components`): Formular-Labels (`fieldset-legend`) kleiner und gedämpft, Eingabefelder mit Haarlinie und Fokusrand in der Akzentfarbe, Badges klein und eckig, Fortschrittsbalken 6 px, Klappboxen (`collapse`) mit Linie statt grauer Fläche, Dialoge und Hinweise flach, Tabellenköpfe klein und gedämpft. So ändern sich alle Formulare ohne Eingriff in ihre Logik.
- **Badges: eine Sprache.** Nur Zustände, die man bemerken soll, werden ein Badge, immer `badge-soft`: „Ohne Kategorie“ und „überfällig“ warning, „Gemeinsam“ info, „Zusammengeführt“ info, „Neu“ primary, „Doppelt“ ghost. Reine Eigenschaften werden Text in der Meta-Zeile: Rolle (Alltag/Sparen) und „Privat“ bei Konten, „Eigene“ bei Kategorien bleibt ein ruhiges Ghost-Badge.
- **Buchungsliste**: weiter nach Tag gruppiert. Tageskopf klein mit Haarlinie. Mit Container-Queries (Tailwind `@container`): In schmalen Spalten (Übersicht rechts, Handy) Name + Meta-Zeile + Betrag wie bisher. Ab Containerbreite `@2xl` Spalten: Gegenpartei · Kategorie · Konto (nur bei mehreren Konten) · Betrag rechtsbündig. Beträge: Einnahmen grün, Ausgaben normale Textfarbe, Umbuchung und Sparen gedämpft. Keine Spaltenköpfe, also keine neuen Texte.
- **Filter**: Monatswechsel als kompakte Gruppe ‹ Oktober 2026 ›. Ab Containerbreite `@3xl` eine Zeile: Monat, Art, Kategorie, Suche mit Knopf. Darunter gestapelt wie bisher.
- **Kontoseite** (`app/[locale]/accounts/[id]`): Kopf mit Bank · Kontoart als Untertitel, Aktionen rechts (Buchung hinzufügen, CSV importieren, Bearbeiten). Kontostand als große Zahl. Ab `lg` zwei Spalten: links Filter + Buchungen, rechts offene Umbuchungen + Budgets.
- **Budgets**: Balken dünn, Zahlen „ausgegeben / Limit“ rechts, Bearbeiten/Löschen als leise Textknöpfe.
- **Ausgaben nach Kategorie**: dünner Balken, Betrag und Anteil in einer Zeile, Hover ohne graue Box.
- **Import-Liste und Regel-Liste**: Zeilen mit Haarlinien, Löschen/Rückgängig als leiser roter Textknopf.

## Nicht-Ziele

- Keine Änderung an Logik, Daten, Routen, APIs oder Texten. Keine neuen Exporte, keine neuen Dateien.
- Formulare behalten ihren Aufbau; sie ändern sich nur über das Theme und einzelne Klassen.

## Schritte

1. Theme-Feinschliff in `globals.css`.
2. Buchungsliste und Filter (transactions).
3. Badges und Listen in accounts, import, rules, transfers, transactions (Kategorien).
4. Budgets und Ausgaben nach Kategorie.
5. Kontoseite in zwei Spalten.
6. Prüfen: Lint, Tests, Browser auf 375 px und 1440 px, hell und dunkel, kein waagerechter Überlauf.

## Change manifest

```change-manifest
version: 1
title: Design part 2 - booking list, badges, forms, filters
slug: design-content
summary: Lists, badges, forms and filters inside each part take on the calm look from part 1. On wide screens the booking list shows columns and the filters fit in one line. Features, data and texts stay the same.
why: After part 1 the frame looks right, but the content inside still uses the default look of the UI library, with loud badges and stacked filters.
unchanged: All features, data, routes, texts and privacy rules stay as they are. No new files and no new public functions. Forms keep their fields and order.
steps:
  - title: Fine-tune the theme
    text: Labels, input fields, badges, progress bars, fold-out boxes and dialogs get a quieter style in one place.
    units: [app]
  - title: Booking list and filters
    text: The booking list shows columns on wide screens. The filters fit in one line there.
    units: [transactions]
  - title: One badge style everywhere
    text: Only states that need attention stay badges. Plain properties become text.
    units: [accounts, import, rules, transfers, transactions]
  - title: Budgets and spending bars
    text: Thin bars and clear figures for budgets and spending by category.
    units: [budgets, transactions]
  - title: Account page in two columns
    text: Bookings on the left, open transfers and budgets on the right.
    units: [app]
files:
  - path: src/app/globals.css
    change: changed
    purpose: Quieter labels, fields, badges, bars, fold-out boxes and dialogs.
  - path: src/transactions/components/transaction-list.tsx
    change: changed
    purpose: Booking rows with columns on wide screens, calmer amounts and badge.
  - path: src/transactions/components/transaction-filters.tsx
    change: changed
    purpose: Compact month switch and one-line filters on wide screens.
  - path: src/transactions/components/category-spending.tsx
    change: changed
    purpose: Thin bars and one line of figures per category.
  - path: src/transactions/components/category-manager.tsx
    change: changed
    purpose: Quiet badge for own categories.
  - path: src/accounts/components/account-list.tsx
    change: changed
    purpose: Role and privacy as text, only "shared" as badge.
  - path: src/accounts/components/account-actions.tsx
    change: changed
    purpose: Quieter archive and delete buttons.
  - path: src/budgets/components/budget-section.tsx
    change: changed
    purpose: Thin budget bars, clear figures, quiet edit buttons.
  - path: src/import/components/import-list.tsx
    change: changed
    purpose: Import rows with hairlines and a quiet undo button.
  - path: src/import/components/import-upload.tsx
    change: changed
    purpose: Preview badges in the common style.
  - path: src/rules/components/rule-list.tsx
    change: changed
    purpose: Rule rows with hairlines and quiet buttons.
  - path: src/transfers/components/transfer-inbox.tsx
    change: changed
    purpose: Overdue badge in the common style.
  - path: src/app/[locale]/accounts/[id]/page.tsx
    change: changed
    purpose: Account page header with actions, two columns on desktop.
signoff: []
```
