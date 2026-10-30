# Statistik: Händler-Ranking

## Ziel

Sehen, bei welchen Händlern das meiste Geld landet. Statistik bekommt einen dritten Tab „Händler“
neben „Monat“ und „Jahr“: eine Rangliste der Händler nach Ausgaben, für einen Monat oder ein Jahr,
für das gewählte Konto oder „Alle meine Konten“.

## Entscheidungen (mit dir abgestimmt)

- **Ort:** eigener Tab `/statistics/merchants`. Kontoauswahl wie in Monat/Jahr. Umschalter
  „Monat | Jahr“ und Pfeile ‹ › für den Zeitraum. Adresse:
  `?account=…&period=month&month=2026-10` oder `?account=…&period=year&year=2026`.
  Ungültige Werte fallen still auf den aktuellen Monat zurück.
- **Gruppieren:** automatisch bereinigt, keine neue Tabelle.
  - Groß-/Kleinschreibung und Leerzeichen egal.
  - ING-Kartenzahlung: Vorsilbe „VISA “ fällt weg („VISA EDEKA MUSTERMARKT“ → „EDEKA MUSTERMARKT“).
  - PayPal: Händler aus dem Verwendungszweck („… Ihr Einkauf bei EasyPark GmbH“ → „EasyPark GmbH“).
    Ohne diesen Text bleibt es „PayPal“.
  - Rechtsform am Ende zählt nicht beim Gruppieren (GmbH, AG, SE, KG, GmbH & Co. KG):
    „EasyPark GmbH“ und „EasyPark“ sind ein Händler.
  - Angezeigt wird die häufigste Schreibweise.
  - Buchungen ohne Namen (oft Handeingaben) stehen gesammelt als „Ohne Händlername“ am Ende.
- **Was zählt:** nur Buchungen der Art Ausgabe. Erstattungen desselben Händlers ziehen ab.
  Umbuchungen und Sparen zählen nie. Händler mit 0 € oder weniger fallen weg.
- **Pro Händler:** Rang, Name, Summe, Balken (Anteil an allen Ausgaben im Zeitraum), Anzahl Käufe,
  Ø pro Kauf, Vergleich zum Vormonat bzw. Vorjahr („↑ 12,40 € mehr als September“, „neu“).
- **Länge:** Top 20, darunter „Alle anzeigen“ (`&all=1`).
- **Klick auf Händler:** Buchungsliste, gefiltert auf Konto, Zeitraum, Art Ausgabe und Suchtext =
  Händlername (die vorhandene Suche über Gegenpartei und Verwendungszweck). „Zurück“ führt zum Ranking.

## Wie es technisch läuft

Gegenpartei und Verwendungszweck sind verschlüsselt, die Datenbank kann nicht nach Händler gruppieren.
Darum: Insights holt die Ausgaben des Zeitraums über den vorhandenen `listTransactions` des
Buchungsdiensts (entschlüsselt, in der Sitzung des Nutzers, also nur sichtbare Konten) und gruppiert
im Server. Ein Jahr sind einige tausend Zeilen, das ist schnell genug. Zwei Abrufe parallel:
Zeitraum und Vorzeitraum.

Keine neue Tabelle, kein neues Paket, keine neue Abhängigkeit (insights → transactions ist erlaubt),
keine API-Route (nur Server-Seite). Datenschutz bleibt: alles läuft über den Buchungsdienst mit
Zeilenschutz, private Konten anderer kommen nie an. Neu ist nur der Typ `MerchantRanking`, den
insights für die Seite exportiert.

Hinweis: Der Suchtext steht wie bei der heutigen Buchungssuche in der Adresse.

## Was gleich bleibt

Monats- und Jahresansicht, Dashboard, Datenbank, Import, Regeln: unverändert.

## Dateien

- `src/insights/merchants.ts` (neu): `merchantOf()` (Name bereinigen, Schlüssel bilden) und
  `rankMerchants()` (gruppieren, summieren, sortieren, Vergleich zum Vorzeitraum).
- `src/insights/merchants.test.ts` (neu): Tests mit Namen aus den Testdaten (VISA, PayPal, Rechtsform,
  Erstattung, ohne Namen, Vergleich).
- `src/insights/contract.ts` (geändert): Typ `MerchantRanking`, Methode `merchantRanking` an `Insights`.
- `src/insights/create-insights.ts` (geändert): `merchantRanking` über `listTransactions`.
- `src/insights/create-insights.test.ts` (geändert): echter Buchungsdienst; Datenschutz: Erika sieht
  keine Händler von Max' privatem Konto, „Alle meine Konten“ mischt keine Mitglieder.
- `src/insights/server.ts` (geändert): exportiert Typ `MerchantRanking`.
- `src/app/[locale]/statistics/merchants/page.tsx` (neu): die Seite.
- `src/app/[locale]/statistics/view-tabs.tsx` (geändert): dritter Tab.
- `src/app/_lib/bookings-href.ts`, `bookings-href.test.ts` (geändert): Suchtext `q` im Link.
- `src/app/_lib/messages/de.json`, `en.json` (geändert): Texte unter `statistics`.

## Schritte

1. `merchants.ts` + Tests (TDD).
2. `merchantRanking` in insights + Integrations- und Datenschutztest.
3. `bookingsHref` mit `q` + Test.
4. Seite, Tab, Texte de/en.
5. Lint, Typecheck, Tests; im Browser prüfen (Monat, Jahr, Alle anzeigen, Klick → Buchungen, Handy-Breite).

## Change manifest

```change-manifest
version: 1
title: Merchant ranking
slug: merchant-ranking
summary: The statistics page gets a third tab "Händler". It ranks the merchants by how much was spent there in a month or a year. A click on a merchant opens its bookings. The other statistics views stay as they are.
why: You want to see where your money goes, merchant by merchant, so you can spend less.
unchanged: The month and year views, the dashboard, the database and the import stay the same. Nobody sees bookings of an account they could not see before.
steps:
  - title: Group spending by merchant
    text: The insights part, which computes the statistics figures, reads the bookings of the period and groups them by a cleaned-up merchant name.
    units: [insights, transactions]
  - title: Show the ranking in a new tab
    text: A new statistics tab lists the merchants with amount, number of purchases and the change from the period before.
    units: [app]
expectedEdges:
  - { from: insights, to: transactions }
  - { from: app, to: insights }
files:
  - path: src/insights/merchants.ts
    change: new
    purpose: Cleans up merchant names and ranks the merchants by spending.
  - path: src/insights/merchants.test.ts
    change: new
    purpose: Tests for cleaning names and ranking merchants.
  - path: src/insights/contract.ts
    change: changed
    purpose: Describes the merchant ranking and the new insights method.
  - path: src/insights/create-insights.ts
    change: changed
    purpose: Computes the merchant ranking from the visible bookings.
  - path: src/insights/create-insights.test.ts
    change: changed
    purpose: Tests the ranking and that nobody sees another member's private merchants.
  - path: src/insights/server.ts
    change: changed
    purpose: Exports the merchant ranking type for the page.
  - path: src/app/[locale]/statistics/merchants/page.tsx
    change: new
    purpose: The new merchants tab of the statistics page.
  - path: src/app/[locale]/statistics/view-tabs.tsx
    change: changed
    purpose: Adds the merchants tab.
  - path: src/app/_lib/bookings-href.ts
    change: changed
    purpose: Links to the bookings can carry a search text.
  - path: src/app/_lib/bookings-href.test.ts
    change: changed
    purpose: Tests the search text in booking links.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts for the merchants tab.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts for the merchants tab.
signoff:
  - kind: export-add
    subject: { unit: insights, name: MerchantRanking, side: server }
    reason: The merchants tab shows its list from it. It holds each merchant's amount, purchases and change.
    plain: A list of merchants, sorted by how much was spent there.
amendments:
  - id: A1
    at: 2026-10-30T15:08:51Z
    on: file
    action: add
    item:
      path: src/app/_lib/back-link.test.ts
      change: changed
      purpose: Tests that the merchants tab is accepted as a return address.
    reason: The new return address needs a test like the other statistics pages.
  - id: A2
    at: 2026-10-30T15:08:51Z
    on: file
    action: add
    item:
      path: src/app/_lib/back-link.ts
      change: changed
      purpose: Accepts the merchants tab as the page the bookings list returns to.
    reason: Without it, "Zurück zur Statistik" on the bookings list would be missing after a click on a merchant.
```
