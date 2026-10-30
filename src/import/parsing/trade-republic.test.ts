import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDecimalAmount, parseTradeRepublic } from "./trade-republic";
import type { ParsedFile } from "./types";

const testFile = readFileSync(new URL("../../../test-data/traderepublic_testdaten.csv", import.meta.url), "utf8");
const HEADER =
  "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code";

function parsed(text: string): ParsedFile {
  const result = parseTradeRepublic(text);
  if (!result.ok) throw new Error(`parse failed: ${result.reason} ${result.line}`);
  return result;
}

const row = (overrides: { type?: string; amount?: string; currency?: string; date?: string }) =>
  `2026-10-01T22:00:00Z,${overrides.date ?? "2026-10-01"},DEFAULT,CASH,${overrides.type ?? "CARD_TRANSACTION"},,Shop,,,,${overrides.amount ?? "-1.00"},,,${overrides.currency ?? "EUR"},,,,Shop,id-1,,,,`;

describe("parseDecimalAmount", () => {
  it.each([
    ["-250.00", -25000],
    ["-6.900000", -690],
    ["1000.000000", 100000],
    ["0.420000", 42],
    ["69.2", 6920],
    ["5", 500],
  ])("reads %s as %i cents", (input, cents) => {
    expect(parseDecimalAmount(input)).toBe(cents);
  });

  it.each(["", "1,00", "1.005", "abc", "1.2.3"])("rejects %s", (input) => {
    expect(parseDecimalAmount(input)).toBeNull();
  });
});

describe("parseTradeRepublic with the test file", () => {
  const file = parsed(testFile);
  const byId = (id: string) => file.rows.find((r) => r.dedupKey === id)!;

  it("reads every row, without a closing balance", () => {
    expect(file.bank).toBe("trade_republic");
    expect(file.rows).toHaveLength(18);
    expect(file.closingBalanceCents).toBeNull();
    expect(file.rows[0].line).toBe(2);
  });

  it("uses the date column, not the UTC timestamp", () => {
    // datetime 2026-09-30T22:14:58Z; in Germany that is already October 1st, the export says 09-30.
    expect(byId("6b65a6a4-8b81-48f6-b38a-088ca65ed389").bookingDate).toBe("2026-09-30");
  });

  it("books buys as saving and sells as transfer", () => {
    expect(byId("bdd640fb-0667-4ad1-9c80-317fa3b1799d")).toMatchObject({ amountCents: -25000, kind: "saving", category: null });
    expect(byId("9a1de644-815e-46d1-bb8f-aa1837f8a88b")).toMatchObject({ amountCents: 6920, kind: "transfer", category: null });
  });

  it("books interest, dividends and saveback as investment income", () => {
    for (const [id, cents] of [
      ["47378190-96da-4dac-b2ff-5d2a386ecbe0", 666],
      ["c241330b-01a9-471f-9e8a-774bcf36d58b", 42],
      ["6b65a6a4-8b81-48f6-b38a-088ca65ed389", 166],
    ] as const) {
      expect(byId(id)).toMatchObject({ amountCents: cents, kind: "income", category: "investmentIncome" });
    }
  });

  it("proposes the type from the sign for everything else", () => {
    expect(byId("b74d0fb1-32e7-4629-8fad-c1a606cb0fb3")).toMatchObject({
      amountCents: -1748,
      kind: "expense",
      counterparty: "STEAMGAMES.COM",
      reference: "STEAMGAMES.COM 4259522985",
    });
    expect(byId("6c307511-b2b9-437a-a8df-6ec4ce4a2bbd")).toMatchObject({
      amountCents: 90000,
      kind: "income",
      counterparty: "Max Mustermann",
      counterpartyIban: "DE94123456781111111111",
      reference: "Direct Debit Top up with DE94123456781111111111",
    });
    expect(byId("759cde66-bacf-43d0-8b1f-9163ce9ff57f")).toMatchObject({
      amountCents: -5000,
      kind: "expense",
      counterparty: "Kind Mustermann",
      counterpartyIban: "DE97123456783333333333",
    });
  });

  it("keeps quoted descriptions with commas whole", () => {
    expect(byId("bdd640fb-0667-4ad1-9c80-317fa3b1799d").reference).toBe(
      "Savings plan execution IE00BJ0KDQ92 Xtrackers (IE) Plc - Xtrackers MSCI World UCITS ETF 1C, quantity: 1.770538",
    );
    expect(byId("bdd640fb-0667-4ad1-9c80-317fa3b1799d").raw.symbol).toBe("IE00BJ0KDQ92");
  });

  it("sums to the expected cash movement", () => {
    expect(file.rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(99311);
  });
});

describe("parseTradeRepublic", () => {
  it("skips zero amounts", () => {
    expect(parsed(`${HEADER}\n${row({ amount: "0.000000" })}`)).toMatchObject({ rows: [], skipped: 1 });
  });

  it("skips rows without a cash movement, like a warrant exercise", () => {
    const exercise =
      '"2026-05-07T08:00:03.638Z","2026-05-07","DEFAULT","CORPORATE_ACTION","WARRANT_EXERCISE","DERIVATIVE","Long Faktor Optionsschein 15","DE000FD2H9Y9","-12.0000000000","","","","","","","","","WARRANT_EXERCISE DE000FD2H9Y9","134f29cd-e38b-3fe5-aad5-3e46cc9c61e0","","","",""';
    expect(parsed(`${HEADER}\n${exercise}\n${row({})}`)).toMatchObject({ rows: [{ amountCents: -100 }], skipped: 1 });
  });

  it("still rejects a missing amount with a currency", () => {
    expect(parseTradeRepublic(`${HEADER}\n${row({ amount: "" })}`)).toEqual({ ok: false, reason: "invalid-row", line: 2 });
  });

  it("rejects other currencies", () => {
    expect(parseTradeRepublic(`${HEADER}\n${row({ currency: "USD" })}`)).toEqual({ ok: false, reason: "unsupported-currency", line: 2 });
  });

  it.each([{ amount: "-1.005" }, { date: "2026-02-30" }, { amount: "x" }])("rejects a broken row %o", (overrides) => {
    expect(parseTradeRepublic(`${HEADER}\n${row(overrides)}`)).toEqual({ ok: false, reason: "invalid-row", line: 2 });
  });

  it("drops an invalid counterparty IBAN", () => {
    const line = `2026-10-01T10:00:00Z,2026-10-01,DEFAULT,CASH,TRANSFER_OUT,,,,,,-5.00,,,EUR,,,,Out,id-2,Someone,DE00XXXX,,`;
    expect(parsed(`${HEADER}\n${line}`).rows[0]).toMatchObject({ counterparty: "Someone", counterpartyIban: null });
  });

  it("rejects a header without the needed columns", () => {
    expect(parseTradeRepublic("date,amount\n2026-10-01,1.00")).toEqual({ ok: false, reason: "unknown-format" });
  });
});
