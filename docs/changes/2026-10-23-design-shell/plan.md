# Design, Teil 1: eigenes Theme, Navigation, Seitenrahmen

## Ziel

Die App sieht nach daisyUI-Standard aus (blaugraues Dunkel, Lila, schwebende Karten), ist auf dem Desktop eine 448-px-Spalte und hat keine feste Navigation. Auf `/household` laufen auf dem Handy Knöpfe aus dem Bild (Seite 502 px breit statt 375 px).

Teil 1 legt das Fundament: ein eigenes, ruhiges Theme, eine feste Navigation und ein Seitenrahmen, der den Platz nutzt. Teil 2 (eigener Plan) überarbeitet danach die Listen und Formulare in den einzelnen Teilen (Buchungsliste als Tabelle auf dem Desktop, Badges, Formular-Abstände).

## Entscheidungen (meine, der User hat die Richtung freigegeben: „kein AI-Slop“)

- **Theme**: zwei eigene daisyUI-Themes in `globals.css` (`haushalt-hell` als Standard, `haushalt-dunkel` bei `prefers-color-scheme: dark`). Warmes Papierweiß bzw. fast schwarzes Neutralgrau statt Blaugrau. Eine Akzentfarbe: tiefes Petrol-Grün (Kassenbuch). Kleine Radien (4–6 px), keine Schatten, keine Tiefe/Noise, Flächen mit 1-px-Linien getrennt statt Karten mit Schatten.
- **Schrift**: IBM Plex Sans und IBM Plex Mono über `next/font/google` (kein neues Paket), statt Geist. Beträge immer mit Tabellenziffern.
- **Navigation**: `AppShell` (neue Datei in `src/app/_lib/`). Desktop (ab `lg`): linke Seitenleiste mit App-Name, Links Übersicht, Statistik, Import, Regeln, Kategorien, Haushalt & Konten, unten Sprache und Abmelden. Handy: schmale Kopfzeile (App-Name, Sprache) und feste Leiste unten mit Übersicht, Statistik, Import, Regeln, Haushalt. Aktiver Eintrag über den Pfad. Icons als kleine Inline-SVGs (kein Icon-Paket).
- **Seitenrahmen**: Inhalt bis `max-w-5xl`, linksbündig neben der Seitenleiste. `PageHeader` (Titel, optional Zurück-Link und Aktion) ersetzt die `card-title`-Köpfe. Formularseiten bleiben schmal (`max-w-xl`), Übersichtsseiten nutzen die Breite.
- **Übersicht**: ab `lg` zwei Spalten. Links Monatszahlen, Budgets, Ausgaben nach Kategorie; rechts letzte Buchungen. Monatszahlen als Kennzahlenreihe mit klarer Hierarchie.
- **Kontoauswahl**: eine Zeile Chips, die auf dem Handy waagerecht scrollt statt umzubrechen (kein Seitenüberlauf).
- **Haushalt**: die Link-Leiste (Import, Regeln, Kategorien) entfällt, die Navigation deckt sie ab. Nur „Konto anlegen“ bleibt neben der Überschrift. Kategorien zusätzlich als Link auf der Seite, weil die Handy-Leiste sie nicht hat.
- **Anmelden, Registrieren, Einladung, Haushalt anlegen**: ohne Navigation, `AuthFrame` mit App-Name und Sprache oben.
- Der Sprachumschalter wandert aus dem Root-Layout in `AppShell` bzw. `AuthFrame`.

## Nicht-Ziele

- Keine Änderung an Logik, Daten, Routen oder Texten außer den neuen Navigationsbeschriftungen.
- Komponenten in den Teilen (`src/transactions/components` usw.) bleiben in Teil 1 unverändert; sie erben nur das neue Theme.

## Schritte

1. Theme und Schrift: `globals.css`, Root-Layout.
2. `AppShell`, `PageHeader`, `AuthFrame` in `src/app/_lib/app-shell.tsx`, Texte in `src/app/_lib/messages/{de,en}.json` (`app.nav`).
3. Alle Seiten unter `src/app/[locale]` auf den neuen Rahmen umstellen.
4. Kontoauswahl und Statistik-Tabs anpassen.
5. Prüfen: `npm run lint`, `npm test`, Browser auf 375 px und 1440 px, hell und dunkel, kein waagerechter Überlauf auf allen Seiten.

## Change manifest

```change-manifest
version: 1
title: Design part 1 - theme, navigation, page frame
slug: design-shell
summary: The app gets its own calm look, a fixed navigation (sidebar on desktop, bar at the bottom on phones) and pages that use the width of a desktop screen. Buttons no longer run off the screen on phones. Data, routes and features stay the same.
why: The current look is the default theme of the UI library. On desktop every page is a narrow column, and on phones some buttons run off the screen.
unchanged: All features, data, routes and privacy rules stay as they are. The lists and forms inside each part keep their structure for now. They only take on the new colours and fonts.
steps:
  - title: New theme and font
    text: Own light and dark colours, smaller corners, no shadows, and the IBM Plex font from Google Fonts.
    units: [app]
  - title: Navigation and page frame
    text: A new app frame with a sidebar on desktop and a bottom bar on phones, plus a common page header.
    units: [app]
  - title: Move every page into the new frame
    text: All pages use the frame. The overview gets two columns on desktop, the account choice scrolls sideways on phones.
    units: [app]
files:
  - path: src/app/globals.css
    change: changed
    purpose: Own light and dark theme, font variables.
  - path: src/app/[locale]/layout.tsx
    change: changed
    purpose: IBM Plex font, language switcher moves into the page frames.
  - path: src/app/_lib/app-shell.tsx
    change: new
    purpose: App frame with sidebar and bottom bar, page header, frame for sign-in pages.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German navigation labels.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English navigation labels.
  - path: src/app/_lib/account-switcher.tsx
    change: changed
    purpose: Account choice as one row that scrolls sideways.
  - path: src/app/[locale]/statistics/view-tabs.tsx
    change: changed
    purpose: Statistics tabs in the new style.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: Overview in the frame, two columns on desktop.
  - path: src/app/[locale]/household/page.tsx
    change: changed
    purpose: Household page in the frame, without the overflowing link row.
  - path: src/app/[locale]/household/new/page.tsx
    change: changed
    purpose: Uses the sign-in frame.
  - path: src/app/[locale]/imports/page.tsx
    change: changed
    purpose: Import page in the frame.
  - path: src/app/[locale]/statistics/page.tsx
    change: changed
    purpose: Statistics in the frame.
  - path: src/app/[locale]/statistics/year/page.tsx
    change: changed
    purpose: Year statistics in the frame.
  - path: src/app/[locale]/transactions/new/page.tsx
    change: changed
    purpose: New booking form in the frame.
  - path: src/app/[locale]/transactions/[id]/page.tsx
    change: changed
    purpose: Booking detail in the frame.
  - path: src/app/[locale]/accounts/new/page.tsx
    change: changed
    purpose: New account form in the frame.
  - path: src/app/[locale]/accounts/[id]/page.tsx
    change: changed
    purpose: Account page in the frame.
  - path: src/app/[locale]/accounts/[id]/edit/page.tsx
    change: changed
    purpose: Account edit form in the frame.
  - path: src/app/[locale]/rules/page.tsx
    change: changed
    purpose: Rules page in the frame.
  - path: src/app/[locale]/rules/new/page.tsx
    change: changed
    purpose: New rule form in the frame.
  - path: src/app/[locale]/rules/[id]/page.tsx
    change: changed
    purpose: Rule edit form in the frame.
  - path: src/app/[locale]/categories/page.tsx
    change: changed
    purpose: Categories page in the frame.
  - path: src/app/[locale]/sign-in/page.tsx
    change: changed
    purpose: Uses the sign-in frame.
  - path: src/app/[locale]/sign-up/page.tsx
    change: changed
    purpose: Uses the sign-in frame.
  - path: src/app/[locale]/invite/[token]/page.tsx
    change: changed
    purpose: Uses the sign-in frame.
signoff: []
```
