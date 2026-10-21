import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIng } from "./ing";
import type { ParsedFile } from "./types";

const testFile = readFileSync(new URL("../../../test-data/ing_testdaten.csv", import.meta.url), "utf8");

function parsed(text: string): ParsedFile {
  const result = parseIng(text);
  if (!result.ok) throw new Error(`parse failed: ${result.reason} ${result.line}`);
  return result;
}

const header = [
  "Umsatzanzeige;Datei erstellt am: 15.10.2026 18:00",
  "",
  "Saldo;10,00;EUR",
  "",
  "Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Referenz;Saldo;Währung;Betrag;Währung",
];

describe("parseIng with the test file", () => {
  const file = parsed(testFile);

  it("reads every booking and the closing balance", () => {
    expect(file.bank).toBe("ing");
    expect(file.rows).toHaveLength(29);
    expect(file.closingBalanceCents).toBe(70326);
    expect(file.skipped).toBe(0);
    expect(file.rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(-109674);
  });

  it("maps the columns of a row", () => {
    expect(file.rows[0]).toMatchObject({
      line: 15,
      bookingDate: "2026-10-15",
      amountCents: -20000,
      kind: "expense",
      category: null,
      counterparty: "Trade Republic",
      counterpartyIban: null,
      reference: "Trade Republic 1a2b3c4d-0000-4000-8000-000000000003",
    });
    expect(file.rows[0].raw).toMatchObject({ Buchungstext: "Lastschrift", Referenz: "TRDE00000003", Saldo: "703,26" });
  });

  it("proposes income for money in, without a category", () => {
    const salary = file.rows.find((row) => row.reference === "LOHN / GEHALT 09/26")!;
    expect(salary).toMatchObject({ bookingDate: "2026-09-28", amountCents: 325000, kind: "income", category: null });
  });

  it("keeps an empty reference as null", () => {
    const transfer = file.rows.find((row) => row.bookingDate === "2026-09-15")!;
    expect(transfer).toMatchObject({ amountCents: 50000, counterparty: "Max Mustermann", reference: null });
  });

  it("counts identical rows on the same day", () => {
    const bakery = file.rows.filter((row) => row.counterparty === "VISA BAECKEREI MUSTERMEHL");
    expect(bakery).toHaveLength(2);
    expect(bakery[0].dedupKey).not.toBe(bakery[1].dedupKey);
    expect(bakery.map((row) => row.dedupKey.endsWith("|1") || row.dedupKey.endsWith("|2"))).toEqual([true, true]);
  });

  it("gives every row a distinct dedup key", () => {
    expect(new Set(file.rows.map((row) => row.dedupKey)).size).toBe(29);
  });
});

describe("parseIng", () => {
  const row = (fields: string) => [...header, fields].join("\r\n");

  it("normalizes case and spaces for the dedup key", () => {
    const a = parsed(row("01.10.2026;01.10.2026;REWE  Markt;Lastschrift;Einkauf;;10,00;EUR;-1,00;EUR"));
    const b = parsed(row("01.10.2026;01.10.2026;rewe markt ;Lastschrift; einkauf;;10,00;EUR;-1,00;EUR"));
    expect(a.rows[0].dedupKey).toBe(b.rows[0].dedupKey);
  });

  it("skips amounts of zero", () => {
    expect(parsed(row("01.10.2026;01.10.2026;X;Info;;;10,00;EUR;0,00;EUR"))).toMatchObject({ rows: [], skipped: 1 });
  });

  it("rejects other currencies", () => {
    expect(parseIng(row("01.10.2026;01.10.2026;X;Lastschrift;;;10,00;EUR;-1,00;USD"))).toEqual({
      ok: false,
      reason: "unsupported-currency",
      line: 6,
    });
  });

  it.each([
    ["31.02.2026;31.02.2026;X;L;;;1,00;EUR;-1,00;EUR"],
    ["2026-10-01;01.10.2026;X;L;;;1,00;EUR;-1,00;EUR"],
    ["01.10.2026;01.10.2026;X;L;;;1,00;EUR;-1.0;EUR"],
    ["01.10.2026;01.10.2026;X"],
  ])("rejects a broken row %s with its line", (fields) => {
    expect(parseIng(row(fields))).toEqual({ ok: false, reason: "invalid-row", line: 6 });
  });

  it("works without a Referenz column and without a saldo line", () => {
    const text = [
      "Buchung;Valuta;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung",
      "01.10.2026;01.10.2026;X;Lastschrift;Y;5,00;EUR;-2,50;EUR",
    ].join("\n");
    expect(parsed(text)).toMatchObject({ closingBalanceCents: null, rows: [{ amountCents: -250, reference: "Y" }] });
  });

  it("cuts very long texts to the booking limits but keeps them in the raw row", () => {
    const long = "x".repeat(600);
    const file = parsed(row(`01.10.2026;01.10.2026;${long};L;${long};;1,00;EUR;-1,00;EUR`));
    expect(file.rows[0].counterparty).toHaveLength(200);
    expect(file.rows[0].reference).toHaveLength(500);
    expect(file.rows[0].raw.Verwendungszweck).toHaveLength(600);
  });

  it("rejects a file without booking header", () => {
    expect(parseIng("Umsatzanzeige\nfoo;bar")).toEqual({ ok: false, reason: "unknown-format" });
  });
});
