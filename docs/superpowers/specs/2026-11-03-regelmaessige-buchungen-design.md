# Regelmäßige Buchungen (Fixkosten) – Design

Stand: 2026-11-03. Gehört zum Bereich „Fixkosten“ in `docs/konzept.md`.

## Wozu

Wer seinen Kontoauszug nicht hochladen will oder kann, soll trotzdem möglichst wenig von Hand
eintragen. Gehalt, Miete, Versicherungen, Abos legt man einmal als **Vorlage** an; die App bucht sie
danach selbst zum Fälligkeitstag.

## Ziele

- Vorlage anlegen direkt aus dem Buchungsformular (Checkbox „Regelmäßig wiederholen“).
- Die App legt fällige Buchungen selbst an, im Hintergrund nach Zeitplan, ohne dass jemand die App
  öffnet.
- Eigene Seite „Regelmäßige Buchungen“: Liste, ändern, pausieren, beenden.
- **Erkennen:** Die App schlägt Vorlagen aus vorhandenen Buchungen vor (z. B. „Netflix 13,99 € jeden
  Monat“). Nur Vorschlag, nie automatisch.

## Nicht-Ziele

- Jahreskosten auf Monate umlegen (später).
- Prognose kommender Zahlungen, Erinnerungen, Benachrichtigungen per Mail/Push.
- Hinweise auf Vorschläge außerhalb der Seite „Regelmäßige Buchungen“ (keine Übersicht, kein
  Import-Hinweis).

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Doppelte Buchungen: durch doppelten Lauf, Neustart oder Deploy.
- Vorlage auf privatem Konto wird für andere sichtbar (Vorlage, Vorschlag oder ihre Existenz).
- Hintergrund-Job bekommt Rechte, alle Daten zu lesen.
- Buchungsdaten (Beträge, Namen, Texte) in Logs.

## Entscheidungen des Nutzers

- App bucht jede fällige Vorlage selbst; kein Bestätigen.
- Vorlage bucht **immer**, auch auf Konten, die regelmäßig importiert werden. Kommt der Kontoauszug,
  sorgt das Zusammenführen beim Import gegen Dopplung.
- Zeitplan im Server statt „beim Öffnen der App“ (App läuft dauerhaft auf Hetzner).
- Erkennen mit rein, nur als Vorschlag auf der Seite „Regelmäßige Buchungen“.
- Umlegen später.

## Verhalten

### Vorlage

Felder: Konto, Betrag (Cent, Vorzeichen wie Buchung), Art, Kategorie, Gegenpartei (+ IBAN),
Verwendungszweck, Zählmonat-Wahl (`counts_next_month`, wie Buchung), Rhythmus, Tag im Monat,
nächste Fälligkeit, optional Enddatum, pausiert ja/nein.

- **Rhythmus:** alle 1, 3, 6 oder 12 Monate. *(Meine Entscheidung.)*
- **Tag im Monat** 1–31; gibt es den Tag im Monat nicht, gilt der letzte Tag (31. → 30.4., 28./29.2.).
- **Art:** jede Buchungsart (Ausgabe, Einnahme, Umbuchung, Sparen). Umbuchung und Sparen bucht die
  Vorlage **nur auf ihrem eigenen Konto** (Entscheidung des Nutzers). Kein Ziel-Konto in der Vorlage,
  keine Gegenbuchung. Die Gegenseite kommt per Import oder eigener Vorlage; der Umbuchungs-Abgleich
  nach dem nächsten Import verknüpft beide. Ein Lauf startet weder Regeln noch Abgleich.
- Die Vorlage hat dieselbe Sichtbarkeit wie ihr Konto: privates Konto → nur Besitzer; gemeinsames
  Konto → alle Mitglieder des Haushalts, alle dürfen sie ändern. Konto gelöscht → Vorlage weg.
  Konto archiviert → Vorlage bucht nicht mehr. Wird das Konto wieder aktiv, kein Nachholen der
  archivierten Zeit: nächste Fälligkeit = erster Termin ab heute, wie beim Fortsetzen.
  *(Meine Entscheidung.)*
- Verschlüsselung wie bei Buchungen: Gegenpartei, IBAN (+ Blind-Index), Verwendungszweck.

### Anlegen aus dem Buchungsformular

- Checkbox „Regelmäßig wiederholen“ nur beim **Neuanlegen**, nicht beim Bearbeiten.
- Angehakt → Felder Rhythmus und optional „Endet am“. Tag im Monat = Tag des Buchungsdatums.
- Speichern legt die Buchung wie bisher an **und** die Vorlage, in einer Transaktion. Die Buchung
  selbst ist das erste Vorkommen; nächste Fälligkeit = Buchungsdatum + Rhythmus.
- Liegt das Buchungsdatum in der Vergangenheit, holt der nächste Lauf die Vorkommen bis heute nach.
  *(Meine Entscheidung: konsistent mit „Verpasstes nachholen“.)*

### Seite „Regelmäßige Buchungen“

- Route `/recurring`, Link in der Navigation.
- Liste je Vorlage: Gegenpartei, Betrag, Konto, Rhythmus, nächste Fälligkeit, Status (aktiv,
  pausiert, beendet).
- Ändern: gilt nur für **künftige** Buchungen; bereits angelegte bleiben.
- Pausieren / Fortsetzen. Beim Fortsetzen keine Nachholung der Pause: nächste Fälligkeit = erster
  Termin ab heute. *(Meine Entscheidung.)*
- Beenden = Enddatum heute setzen; Vorlage bleibt in der Liste (Status beendet).
- Löschen ist eine eigene Aktion (mit Bestätigung): Vorlage und ihre Vorkommen-Zeilen weg
  (cascade); angelegte Buchungen bleiben als normale Buchungen, ohne Hinweis „aus Vorlage“.
  *(Meine Entscheidung.)*
- Darunter Abschnitt „Vorschläge“ (siehe Erkennen).

### Angelegte Buchungen

- Normale Buchungen, `classified_by = manual` (eine Person hat Art und Kategorie in der Vorlage
  gewählt; Regeln ändern sie also nie).
- Kein Fingerabdruck → beim Import Kandidat fürs Zusammenführen (gleicher Betrag, gleiches Konto,
  ± 3 Tage), wie jede Handbuchung. Zusammenführen bleibt **exakt** (Entscheidung des Nutzers):
  weicht der Bankbetrag ab (Gehalt 3.050 statt 3.000), entstehen zwei Buchungen, eine löscht man von
  Hand. Import-Teil ändert sich nicht.
- Einzeln änderbar und löschbar. Eine gelöschte angelegte Buchung wird **nicht** neu angelegt.
- Die Buchungsliste zeigt an der Buchung „aus Vorlage“ (Link zur Vorlage).

### Zeitplan

- `src/instrumentation.ts`: Next.js ruft `register()` einmal beim Serverstart (nur
  `NEXT_RUNTIME === "nodejs"`). Dort ein Lauf sofort, danach `setInterval` stündlich.
- Ein Lauf = ein Aufruf der SQL-Funktion `recurring_book_due(today date)`. `today` = heutiges Datum
  in `Europe/Berlin`.
- Die Funktion: für jede aktive Vorlage mit nächster Fälligkeit ≤ `today` (Konto nicht archiviert,
  vor Enddatum) für jeden fälligen Tag eine Buchung anlegen und die nächste Fälligkeit weiterrücken.
  Vorlagen mit `FOR UPDATE SKIP LOCKED` sperren; zusätzlich eindeutiger Schlüssel
  (Vorlage, Fälligkeitstag) in einer Vorkommen-Tabelle. Damit keine Dopplung bei parallelen Läufen
  (zwei Container beim Deploy) oder Neustart.
- Rückgabe nur die Anzahl angelegter Buchungen. Log nur diese Zahl, nie Inhalte.
- Fehler in einem Lauf beenden den Prozess nicht; nächster Lauf versucht es erneut.
- Verschlüsselte Felder kopiert die Funktion als Ciphertext aus der Vorlage; Schlüssel bleiben
  außerhalb der Datenbank.

### Datenbank-Rechte

- Neue Rolle `recurring_runner` (NOLOGIN), an `app_runtime` mit `WITH INHERIT FALSE` vergeben – wie
  `households_admin`. Sie hat **nur** `EXECUTE` auf `recurring_book_due`, keine Tabellenrechte.
- `recurring_book_due` ist `SECURITY DEFINER`, `SET search_path = public`, schreibt nur Vorlagen-,
  Vorkommen- und Buchungszeilen, liest nichts nach außen.
- Vorlagen-, Vorkommen- und Vorschlags-Tabellen: Grants und Row-Level-Security für `app_user` über
  die Sichtbarkeit des Kontos (`accounts_visible_account_ids` via `db-contract`), wie bei Buchungen.
  Keine Domain-Rechte für `app_runtime`.

### Erkennen (Schritt 2)

- Reine Funktion wie Regel-Vorschläge (`src/rules/suggestions.ts`), läuft auf dem Server nach dem
  Entschlüsseln, beim Aufruf der Seite.
- Gruppe = gleiches Konto + gleiche Gegenpartei (normalisiert) + gleiche Art.
- Vorschlag, wenn mindestens 3 Buchungen, Abstände passen zu einem Rhythmus (1, 3, 6, 12 Monate,
  ± 5 Tage) und Beträge ähnlich (± 10 % vom Median). *(Schwellen meine Entscheidung, im Test
  festgehalten.)* Letzte Buchung nicht älter als 2 Rhythmen.
- Kein Vorschlag, wenn es schon eine Vorlage mit gleichem Konto und gleicher Gegenpartei gibt, oder
  die Gruppe aus Vorlagen-Buchungen besteht.
- Vorschlag zeigt Gegenpartei, typischen Betrag, Rhythmus, Anzahl. Knöpfe „Als Vorlage übernehmen“
  (Formular vorausgefüllt: Betrag = letzter Betrag, Tag = Tag der letzten Buchung, nächste
  Fälligkeit = nächster Termin nach der letzten Buchung, Art und Kategorie der letzten Buchung) und
  „Ausblenden“ (pro Person gespeichert, Gegenpartei als Blind-Index, wie bei Regel-Vorschlägen).
- Privatsphäre: nur Buchungen der sichtbaren Konten; Vorschlag zu privatem Konto nur für Besitzer.

## Architektur

- Keine Änderung an `import` und `transfers`.
- Neuer Teil `src/recurring/` (Vorlagen, Zeitplan-Lauf, Erkennen) → nutzt `shared`, `transactions`,
  `db-contract`. Tabellen: `recurring_template`, `recurring_occurrence`,
  `recurring_suggestion_dismissal`. Freigabe über change-map.
- Anlegen aus dem Formular: App-Route ruft Buchung (transactions) und Vorlage (recurring) in einer
  `withSession`-Transaktion auf; recurring-Methode bekommt die `RlsTransaction`.
- `src/instrumentation.ts` gehört zur App-Schicht und ruft nur den Einstiegspunkt von recurring.
- Texte in `src/recurring/messages/{de,en}.json`.

## Tests

- Fälligkeitsrechnung: Monatsende, Februar/Schaltjahr, Rhythmus 3/6/12, Enddatum, Pause.
- `recurring_book_due`: legt fällige Buchungen an, holt nach, keine Dopplung bei zwei parallelen
  Läufen, archiviertes Konto bucht nicht, gelöschte Buchung kommt nicht wieder.
- Rolle `recurring_runner` kann keine Tabelle lesen.
- Privatsphäre (Pflicht): Mitglied sieht keine Vorlage und keinen Vorschlag zu privatem Konto eines
  anderen; API-Routen geprüft.
- Erkennen: positive und negative Fälle (zu wenige, unregelmäßig, Betrag schwankt zu stark).
- Formular: Checkbox legt Buchung + Vorlage an; Fehler → beides nicht.
- i18n-Schlüssel gleich in de/en.

## Lieferung

Zwei Schritte, je ein eigener Plan:
1. Vorlagen, Formular-Checkbox, Seite, Zeitplan.
2. Erkennen.

## Offen für den Builder

Dateiaufteilung, Komponentenschnitt, genaue Spaltennamen, Zeitzonen-Helfer.
