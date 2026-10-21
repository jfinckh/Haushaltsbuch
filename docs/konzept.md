# Haushaltsbuch – Produktkonzept

Oct 19, 2026 · @Johannes

## Vision & Grundprinzipien

Ein Haushaltsbuch für meine Partnerin und mich, das eine Frage sofort beantwortet: **Wie viel können wir diesen Monat noch ausgeben?** Andere Nutzer sind nicht im Scope; die App ist aber so aufgebaut, dass später weitere Haushalte sauber getrennt dazukommen können.

- **Haushalt als Grundeinheit.** Alle Daten hängen an einem Haushalt, und jede Abfrage filtert danach. So bleiben Haushalte strikt getrennt, wenn später weitere dazukommen.
- **Import vor Eingabe.** Die meisten Buchungen kommen per CSV; manuelle Eingabe ist für Bargeld und Korrekturen. Buchungen können aber auch von Hand hinzugefügt werden.
- **Eine Zahl zuerst.** Das Dashboard beginnt mit dem verfügbaren Betrag, nicht mit zehn Kennzahlen.
- **Ehrliche Zahlen.** Umbuchungen zwischen eigenen Konten sind keine Ausgaben, Sparen ist kein Konsum.
- **Eine Codebasis.** Next.js-Web-App mit API-Routen, mobil zuerst als PWA.

## Kernkonzepte & Datenmodell

Diese Objekte tragen die ganze App; sie früh richtig zu schneiden spart später die meisten Umbauten.

| Objekt | Wichtigste Felder | Hinweis |
| --- | --- | --- |
| Haushalt | Name, Währung | Alles hängt an einem Haushalt |
| Mitglied | Nutzer, Haushalt | Keine Rollen, alle dürfen alles |
| Konto | Name, Bank, IBAN, Typ, Rolle (Alltag/Sparen), Besitzer, privat oder gemeinsam, Startsaldo | Zum Start: ING Giro (privat), ING Gemeinschaftskonto (gemeinsam, gleicher Parser wie Giro), Trade Republic Verrechnungskonto, Trade Republic Depot, Bargeld |
| Transaktion | Konto, Datum, Betrag, Gegenpartei, Gegen-IBAN, Verwendungszweck, Kategorie, Art, verknüpfte Gegenbuchung, angelegt von | Art: Ausgabe, Einnahme, Umbuchung, Sparen |
| Kategorie | Name, Oberkategorie, Typ | Zwei Ebenen reichen, pro Haushalt und pro Nutzer anpassbar |
| Budget | Konto, Kategorie, Betrag, Zeitraum | Gilt für ein Konto; Budgets eines privaten Kontos sieht nur sein Besitzer |
| Regel | Bedingung (z. B. Gegenpartei enthält „REWE“), Kategorie | Grundlage der Auto-Kategorisierung |
| Import | CSV-Datei, Bank, Konto, Zeitraum, Status | Ermöglicht Rückgängig und Duplikatprüfung |

Technische Leitplanken:

- Beträge als **Ganzzahl in Cent** speichern, nie als Float.
- Umbuchungen als **Paar** zweier verknüpfter Transaktionen, damit beide Konten stimmen.
- Jede Transaktion behält die **Rohdaten** aus dem Import, damit Regeln später neu angewendet werden können.
- Ein Monat ist immer der **Kalendermonat** (vom 1. bis zum letzten Tag); es gibt keinen einstellbaren Monatsbeginn.

## Familienfunktionen

Bewusst einfach: keine Rollen, und jedes Konto ist entweder privat oder gemeinsam.

- Jedes Mitglied kann einladen, Konten anlegen und auf gemeinsamen Konten buchen, importieren und Budgets ändern.
- Privates Konto: nur der Besitzer sieht und bebucht es, mit allen Buchungen, Auswertungen und Budgets. Andere Mitglieder sehen nicht einmal, dass es existiert. Gemeinsames Konto: alle im Haushalt sehen und bebuchen es. Wer ein Konto anlegt, wählt das; es lässt sich später ändern.
- Auswertungen gibt es pro Konto, nicht pro Haushalt: Ausgaben, Kategorien, Budgets und Kennzahlen beziehen sich immer auf das gewählte Konto. Jeder wählt aus den Konten, die er sehen darf: seine privaten und die gemeinsamen.
- Umbuchungen zwischen privat und gemeinsam: Auf dem Gemeinschaftskonto steht nur „Umbuchung von Max (privat)“, ohne Kontoname, Saldo oder weitere Buchungen. Der Abgleich läuft auf dem Server über alle Konten, zeigt aber jedem nur seine eigene Seite.
- **Gesamtansicht „Alle meine Konten“:** fasst die eigenen privaten Konten zusammen (z. B. ING Giro + Trade Republic). Umbuchungen zwischen ihnen heben sich auf. Gemeinsame Konten sind nicht enthalten, weil dort auch das Geld der Partnerin liegt; Überweisungen aufs Gemeinschaftskonto erscheinen als eigene Zeile „Beitrag Gemeinschaftskonto“, nicht als Ausgabe einer Kategorie, verringern aber den verfügbaren Betrag.
- Einladung per Link; wer ihn annimmt, wird Mitglied des Haushalts.

## Dashboard & Kennzahlen

Das Dashboard zeigt immer ein Konto, oben per Umschalter gewählt (z. B. „Alle meine Konten“ | „ING Giro“ | „Gemeinschaftskonto“), und darunter von oben nach unten: verfügbarer Betrag, Budgetstand, Ausgaben nach Kategorie, letzte Buchungen.

1. **Verfügbar diesen Monat** – große Zahl, darunter Einnahmen und Ausgaben bisher.
2. **Budgets** – ein Fortschrittsbalken pro Kategorie, Warnfarbe ab 80 %.
3. **Ausgaben nach Kategorie** – Donut- oder Balkendiagramm, antippbar bis zu den Buchungen.
4. **Letzte Buchungen** – die neuesten 5–10, unkategorisierte hervorgehoben.

Kennzahlen, nach Phase sortiert (alle anderen aus dem Entwurf kommen in die Statistik-Seite):

| Kennzahl | Berechnung |
| --- | --- |
| Verfügbar diesen Monat | Einnahmen − Ausgaben − geplantes Sparen |
| Budgetverbrauch | Ausgaben bisher / Monatsbudget |
| Sparquote | Gespartes / Nettoeinnahmen |
| Durchschnittsausgaben | Mittel der letzten 3–12 Monate je Kategorie |
| Fixkostenquote | Monatliche Fixkosten / Nettoeinnahmen |
| Prognose Monatsende | Saldo + erwartete Einnahmen − kommende Fixkosten |
| Notgroschen-Reichweite | Liquide Rücklagen / notwendige Monatsausgaben |
| Nettovermögen & Wachstum | Vermögen − Schulden, Veränderung zum Vormonat |

## Features nach Bereichen

„Jetzt“ ist der Umfang, den wir als Erstes bauen; alles andere kommt, wenn wir es im Alltag vermissen.

| Bereich | Funktionen | Umfang |
| --- | --- | --- |
| Haushalt | Haushalt anlegen, Partnerin per Link einladen | Jetzt |
| Konten | Giro, Tagesgeld, Trade Republic, Bargeld, Startsaldo | Jetzt |
| Transaktionen | Erfassen, suchen, filtern, kategorisieren, Schnelleingabe | Jetzt |
| Import | CSV-Exporte von ING und Trade Republic, Duplikatprüfung, Rückgängig | Jetzt |
| Kategorisierung | Regeln („REWE → Lebensmittel“), aus Korrekturen lernen | Jetzt |
| Budgets | Monatslimit pro Kategorie, Warnung ab 80 % | Jetzt |
| Statistiken | Monatsvergleich, Trends, Sparquote, Jahresübersicht | Jetzt |
| Fixkosten | Wiederkehrende Zahlungen erkennen, Jahreskosten auf Monate umlegen | Später |
| Sparziele | Ziel, Zielbetrag, Datum, Fortschritt, monatliche Rate | Später |
| Prognose | Kontostand Monatsende, kommende Rechnungen | Später |
| Monatsabschluss | Was lief besser oder schlechter als im Vormonat | Später |
| Vermögen | Depot, Schulden, Nettovermögen, Verlauf | Später |
| Weitere Banken | Import für andere Banken oder automatischer Abruf | Später |
| Empfehlungen | Auffälligkeiten, Sparpotenziale, KI-Zusammenfassung | Später |

## Kategorien & Sonderfälle

Standardkategorien mit zwei Ebenen, pro Haushalt und pro Individualnutzer anpassbar. Es gibt also Dashboards für Individualnutzer (private Konten), sowie für das Gemeinschaftskonto:

- **Wohnen:** Miete, Nebenkosten, Strom, Internet
- **Lebensmittel:** Supermarkt, Drogerie
- **Mobilität:** Auto, Tanken, ÖPNV
- **Versicherungen & Verträge:** Versicherungen, Abos, Handy
- **Freizeit:** Restaurant, Ausgehen, Hobbys, Urlaub
- **Kinder:** Betreuung, Kleidung, Schule
- **Gesundheit:** Apotheke, Arzt, Sport
- **Shopping:** Kleidung, Elektronik, Haushalt
- **Sonstiges**

Diese Fälle sind **keine Kategorien, sondern eine eigene Buchungsart**, damit sie die Ausgaben nicht verfälschen:

| Fall | Behandlung |
| --- | --- |
| Einnahmen | Gehalt, Kindergeld, Erstattungen; eigene Einnahmekategorien |
| Umbuchung | Geld zwischen eigenen Konten; zählt weder als Ausgabe noch Einnahme |
| Sparen/Investieren | Überweisung aufs Tagesgeld oder Depot; zählt für die Sparquote |
| Erstattung | Rückzahlung verringert die Ausgabe der ursprünglichen Kategorie |
| Kreditkartenabrechnung | Umbuchung vom Giro- aufs Kreditkartenkonto, keine zweite Ausgabe |

## Umbuchungen & Sparen

Eine Umbuchung ist **ein Vorgang mit zwei verknüpften Buchungen**: −X auf dem einen Konto, +X auf dem anderen. Beide tragen die Art „Umbuchung“ und zählen weder als Ausgabe noch als Einnahme; die Kontostände stimmen trotzdem.

Die Fälle aus den echten Exporten (ING Giro, Trade Republic):

| Fall | Beispiel | Erkennung | Zählt als |
| --- | --- | --- | --- |
| Zwischen zwei Konten in der App | ING −1.000 € am 14.10. ↔ Trade Republic +1.000 € am 15.10. | Gleicher Betrag mit umgekehrtem Vorzeichen, Datum ± 5 Tage, Hinweis im Text („Trade Republic“ bzw. „Top up with \<IBAN des ING-Kontos>“) | Umbuchung, neutral |
| Von einem eigenen Konto, das nicht in der App ist | ING +500 €, Absender: eigener Name | Absender = Name eines Mitglieds oder bekannte eigene IBAN | Umbuchung von „Externes eigenes Konto“, neutral |
| Auf das Gemeinschaftskonto | ING −1.200 € Dauerauftrag „Miete und co“ | Der ING-Export enthält keine Empfänger-IBAN; erkannt wird die Gegenbuchung auf dem Gemeinschaftskonto, sonst greift eine Regel (Verwendungszweck „Miete und co“ → Umbuchung Gemeinschaftskonto) | Umbuchung; die Miete zählt erst als Ausgabe, wenn sie vom Gemeinschaftskonto abgeht |
| Mietanteil der Partnerin | Gemeinschaftskonto +X € von Erika Mustermann | Importiert sie ihr Privatkonto: Gegenbuchung wie bei ING ↔ Trade Republic. Sonst: Absender ist ein Haushaltsmitglied | Umbuchung, neutral |
| Sparplan, Wertpapierkauf | Trade Republic −250 € „Savings plan execution“ | Spalte `type` = BUY | Umbuchung ins Depot = **Sparen** |
| Wertpapierverkauf | Trade Republic +69,20 € Bitcoin-Verkauf | `type` = SELL | Umbuchung aus dem Depot, neutral |
| Erträge | Zinsen 6,66 €, Dividende, Saveback 1,66 € | `type` = INTEREST\_PAYMENT, DIVIDEND, BENEFITS\_SAVEBACK | Einnahme |

So funktioniert der Abgleich:

- Jedes Konto hat eine **IBAN** und eine **Rolle: Alltag oder Sparen**. Trade Republic wird zwei Konten: Verrechnungskonto (Alltag, dort laufen auch Kartenzahlungen) und Depot (Sparen).
- **Sparen** = Geld, das von einem Alltagskonto auf ein Sparkonto fließt. ING → Trade-Republic-Verrechnungskonto ist also neutral; erst der Sparplan ins Depot zählt für die Sparquote. So wird nichts doppelt gezählt.
- Der Abgleich läuft bei **jedem Import über alle Konten**. Reihenfolge und Abstand der Uploads sind egal: Die erste Hälfte bleibt als „offene Umbuchung“ stehen, bis die Gegenbuchung importiert wird, auch Tage oder Wochen später. Das Fenster von ± 5 Tagen gilt für die Buchungsdaten, nicht für den Upload.
- **Mehrere passende Kandidaten** (z. B. beide Partner überweisen am selben Tag gleich viel aufs Gemeinschaftskonto): entscheidet der Name von Absender bzw. Empfänger, dann das nächstliegende Datum. Gleiche Daueraufträge aus verschiedenen Monaten werden so nie über Kreuz verknüpft.
- Eindeutige Treffer werden automatisch verknüpft, unsichere in der Vorschau vorgeschlagen. Jede Verknüpfung lässt sich von Hand lösen oder setzen.
- Offene Umbuchungen älter als 14 Tage werden markiert: Dann fehlt ein Import, die Gegenseite wird nie importiert, oder es war doch eine Ausgabe.
- **Umbuchung ohne Gegenbuchung:** Jede Buchung lässt sich von Hand als Umbuchung markieren, auch ohne Partner. Man wählt nur die Herkunft bzw. das Ziel: ein Konto in der App (z. B. Bargeld bei einer Bareinzahlung) oder „Externes eigenes Geld“ (Partnerin importiert ihr Konto nicht, Datei fehlt). Die Buchung zählt dann weder als Einnahme noch als Ausgabe, der Kontostand stimmt trotzdem.
- **Als Regel merken:** Beim Markieren kann man anhaken „Künftig immer so“, z. B. „Absender Erika Mustermann auf dem Gemeinschaftskonto = Umbuchung“. Taucht später doch die Gegenbuchung auf, wird sie automatisch angehängt.
- **Korrigieren in der App:** In der Buchungsdetailansicht lassen sich Verknüpfungen lösen, eine andere Gegenbuchung wählen (Liste passender Kandidaten) oder die Art ändern (Umbuchung, Ausgabe, Einnahme, Sparen).
- **Von Hand gewinnt immer:** Jede manuelle Entscheidung wird als manuell gespeichert. Spätere Importe und der automatische Abgleich überschreiben sie nie und verknüpfen eine gelöste Buchung nicht erneut mit derselben Gegenbuchung.

## CSV-Import

Wir importieren die CSV-Exporte von ING (Online-Banking im Browser) und Trade Republic (App: Service → Kontoauszüge → Transaktionsexport); jede Bank bekommt einen eigenen kleinen Parser.

1. CSV hochladen und Zielkonto wählen; die App erkennt die Bank am Spaltenaufbau.
2. Zeilen in Buchungen umwandeln: Datum, Betrag, Gegenpartei, Verwendungszweck. Deutsche Formate beachten („1.234,56“, TT.MM.JJJJ, Semikolon als Trennzeichen).
3. Duplikate aussortieren (siehe unten).
4. Regeln anwenden: Kategorie und Buchungsart vorschlagen, Umbuchungen zwischen eigenen Konten erkennen (z. B. ING → Trade Republic).
5. Vorschau: neue, bereits vorhandene und unsichere Buchungen getrennt anzeigen; Korrekturen können als neue Regel gespeichert werden.
6. Import bestätigen; er bleibt als Einheit rückgängig machbar.

Bei Trade Republic Sparplan- und Wertpapierkäufe als „Sparen/Investieren“ buchen, Zinsen als Einnahme.

### Keine doppelten Buchungen

Jede Buchung bekommt beim Import einen **Fingerabdruck**, und die Datenbank lässt denselben Fingerabdruck pro Konto nur einmal zu. Überlappende Exporte (Februar–März, dann März–April) sind damit kein Problem: die März-Buchungen werden erkannt und übersprungen.

- **Eindeutige ID der Bank zuerst:** Trade Republic liefert eine eindeutige \`transaction\_id\`; sie ist dort der Fingerabdruck. ING liefert keine, dafür pro Zeile den Saldo, mit dem sich jeder Import gegenprüfen lässt.
- **Sonst ein Hash** aus Konto, Buchungsdatum, Betrag, Gegenpartei und Verwendungszweck, vorher normalisiert (Leerzeichen, Groß-/Kleinschreibung).
- **Gleiche Buchungen am selben Tag** (zweimal 3,50 € beim selben Bäcker) werden durchgezählt: die zweite gleiche Zeile bekommt Zähler 2. Ein späterer Export mit denselben zwei Zeilen erkennt beide als vorhanden, ein dritter Kauf wird als neu erkannt.
- **Von Hand erfasste Buchungen** haben keinen Fingerabdruck. Findet der Import eine passende Buchung (gleicher Betrag, gleiches Konto, Datum ± 3 Tage), schlägt er vor, beide zusammenzuführen, statt sie doppelt anzulegen.
- Die Vorschau zeigt z. B. „40 Zeilen: 28 neu, 12 bereits vorhanden“, damit man sieht, was passiert.

## Datenschutz & Sicherheit

Der Entwurf schlug „lokal speichern“ vor; das passt nicht zu geteilten Familienkonten auf mehreren Geräten. Stattdessen: Server-Speicherung, aber streng abgesichert.

- **Hosting in der EU**, Auftragsverarbeitungsvertrag mit jedem Dienstleister (DSGVO).
- **Verschlüsselung** bei Übertragung (TLS) und Speicherung; sensible Felder wie IBAN zusätzlich auf Feldebene.
- **Zugriffsprüfung im Service-Layer:** jede Abfrage prüft Haushaltsmitgliedschaft und Kontosichtbarkeit. Private Konten anderer sind auch über die API nicht abrufbar, nicht einmal als Summe.
- **Login** mit starkem Passwort oder Passkey, optional 2FA; in der App Sperre per Face ID oder Fingerabdruck.
- **Datenhoheit:** vollständiger Export (CSV/JSON) und Konto löschen auf Knopfdruck.
- **Minimal speichern:** keine Bank-Zugangsdaten im MVP, nur hochgeladene Dateien.

## Technik

Stack: Next.js mit API-Routen, Postgres, TypeScript strict, Zod an jeder API-Grenze. Start lokal, Deployment später (voraussichtlich Hetzner).

### Verschlüsselung

Nicht alles verschlüsseln, sondern in Schichten:

| Schicht | Was | Schutz gegen |
| --- | --- | --- |
| Transport & Speicher | HTTPS, verschlüsselte Platte bzw. Volume | Mitlesen, gestohlene Datenträger |
| Feldverschlüsselung in der App | IBANs, Gegenpartei-Namen, Verwendungszweck, Rohdaten der Importe, hochgeladene Dateien | Geleakte Datenbank-Dumps und Backups |
| Unverschlüsselt | Beträge, Datum, Kategorie, Konto-ID | – nötig für Summen, Filter, Duplikate und Abgleich |

- **Suchbar trotz Verschlüsselung:** neben der verschlüsselten IBAN ein HMAC („Blind Index“) speichern; die Duplikat-Fingerabdrücke genauso.
- **Schlüssel nie in der Datenbank**, sondern aus Umgebungsvariable oder Secrets-Datei. Schlüsselversion pro Wert speichern, damit Rotation möglich bleibt.
- **Grenze:** Wer den laufenden Server übernimmt, hat auch den Schlüssel. Die Feldverschlüsselung schützt vor Dumps und Backups, nicht vor einem kompromittierten Server.
- **Kein Ende-zu-Ende:** Es würde Abgleich und Kategorisierung auf dem Server verhindern und für das Gemeinschaftskonto einen Schlüsseltausch zwischen den Nutzern verlangen.

### Module & Architekturgrenzen

Ein normales Next.js-Projekt mit `src/`-Ordner, kein Monorepo. Die Grenzen zwischen den Modulen sichert change-map mit eslint-plugin-boundaries: Jedes Modul ist ein **Part** unter `src/`, wird nur über seine Einstiegspunkte importiert (`index.ts` browser-sicher, `server.ts` nur Server), und die Regeln legen fest, wer wen nutzen darf.

```
src/app/            nur Routing (Seiten, API-Routen)
src/shared/         Helfer, Geld (Cent, deutsches Zahlenformat), UI-Grundbausteine
src/auth/           Login, Sessions, Einladungslinks       → shared
src/households/     Haushalte, Mitglieder, Sichtbarkeit     → shared, auth
src/accounts/       Konten, Rolle (Alltag/Sparen)           → shared, households
src/transactions/   Buchungen, Kategorien, Regeln           → shared, accounts
src/transfers/      Umbuchungsabgleich, manuelles Verknüpfen → transactions
src/import/         ING- und Trade-Republic-Parser, Duplikate → transactions, transfers, accounts
src/budgets/        Budgets pro Konto                       → transactions
src/insights/       Dashboard-Zahlen, Gesamtansicht         → transactions, budgets, accounts
```

- **`src/app/` bleibt dünn:** Seiten und API-Routen rufen nur die Einstiegspunkte der Parts auf.
- **Wiederverwendbare Parts** wie `auth` und `shared` nutzen nichts Fachliches. Braucht ein zweites Projekt sie, werden sie als privates npm-Paket (GitHub Packages) herausgelöst; dank sauberer Grenzen ist das weitgehend mechanisch.
- **Auth nicht selbst bauen:** `src/auth` ist eine dünne Schicht über einer Bibliothek wie Better Auth. Die Bibliothek übernimmt Passwörter, Sessions, Passkeys und Sicherheitsupdates; der Part bringt Schema, Registrierung nur per Einladung, Login-Screens und Routenschutz mit.
- **Neue Parts und neue Nutzungen** laufen über change-map (`change-map add`, `change-map allow`) und brauchen eine Freigabe im Plan.

### Lokal starten

Postgres per Docker Compose, Next.js im Dev-Modus, Drizzle oder Prisma für Migrationen. Ein Seed-Skript importiert die Testdaten. Später läuft dasselbe Compose-Setup auf dem Server.

### Weitere Punkte

- **Wichtigster Test: Privatsphäre.** Automatische Tests prüfen, dass kein Nutzer über irgendeine API-Route private Konten anderer abrufen kann. Zusätzlich Row-Level Security in Postgres, damit schon die Datenbank nur erlaubte Zeilen liefert.
- **Beträge als Ganzzahl in Cent, Buchungsdatum als reines Datum.** Trade Republic liefert UTC-Zeitstempel, die sonst auf den Vortag rutschen können.
- **Parser und Abgleich testen** (z. B. Vitest) mit den Testdaten; hier entstehen leise Fehler am ehesten.
- **Keine Buchungsdaten oder IBANs im Log**, auch nicht in Fehlermeldungen.
- **Registrierung nur per Einladungslink**, mit Passkey oder 2FA.
- **Verschlüsselte Backups ab Tag eins** (z. B. restic), Wiederherstellung mindestens einmal testen.

## Testdaten

Zwei fiktive Exporte im Format der echten Dateien (`ing_testdaten.csv`, `traderepublic_testdaten.csv`), Zeitraum 01.09.–15.10.2026, alle Namen und IBANs erfunden. Jeder Sonderfall kommt mindestens einmal vor:

| Fall | Wo | Erwartetes Ergebnis |
| --- | --- | --- |
| Umbuchung ING → Trade Republic | ING −900 € (30.09.) ↔ TR +900 € (02.10.); ING −1.000 € (14.10.) ↔ TR +1.000 € (15.10.) | Zwei verknüpfte Umbuchungen |
| Offene Umbuchung | ING −200 € an Trade Republic (15.10.), keine Gegenbuchung | Bleibt offen, Hinweis nach 14 Tagen |
| Gemeinschaftskonto | ING −1.200 € „Miete und co“ am 01.09. und 01.10. | Umbuchung zum Gemeinschaftskonto |
| Externes eigenes Konto | ING +500 € von Max Mustermann (15.09.) | Umbuchung von externem Konto |
| Gleiche Buchung am selben Tag | ING 2 × 3,50 € Bäckerei (08.09.), identischer Text | Beide bleiben erhalten |
| Händler hinter PayPal | ING Spotify, EasyPark | Händler aus dem Verwendungszweck |
| Erstattung | ING −184 € Zahnarzt, +120 € Krankenkasse | Erstattung mindert Gesundheit |
| Gehalt, Spesen | ING +3.250 € Gehalt, +56 € Reisekosten | Einnahmen |
| Partnerin überweist | ING +150 € von Erika Mustermann | Ermessensfall: Einnahme oder Umbuchung im Haushalt |
| Sparplan, Saveback-Kauf | TR BUY | Sparen |
| Verkauf | TR SELL Bitcoin +69,20 € | Neutral |
| Erträge | TR Zinsen, Dividende (USD), Saveback | Einnahmen |
| Kartenzahlung mit Fremdwährung | TR Steam 20 USD = −17,48 € | Ausgabe in EUR |
| Überweisung an Dritte | TR −50 € an Kind Mustermann | Ausgabe |

Zum Prüfen von Duplikaten: dieselbe Datei zweimal importieren (0 neu) oder eine gekürzte Kopie mit überlappendem Zeitraum. Der letzte ING-Saldo von 703,26 € muss nach dem Import dem Kontostand entsprechen.

## Offene Fragen

- [ ] Reichen gemeinsame Konten, oder brauchen wir „wer schuldet wem“ für privat ausgelegte Ausgaben?
- [ ] Welche ING-Konten importieren wir: nur Giro oder auch Extra-Konto und Depot?
- [ ] Deployment auf Hetzner: Setup, Domain, Backups (später, zunächst lokal).
- [ ] Von welchem eigenen Konto kommen die +500 €? In der App anlegen oder als extern markieren? Importiert Erika ihr Privatkonto auch (welche Bank)?
