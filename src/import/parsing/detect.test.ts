import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBankFile } from "./detect";

const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-data/${name}`, import.meta.url)));

describe("parseBankFile", () => {
  it("detects ING from its columns", () => {
    expect(parseBankFile(bytes("ing_testdaten.csv"))).toMatchObject({ ok: true, bank: "ing" });
  });

  it("detects Trade Republic from its columns", () => {
    expect(parseBankFile(bytes("traderepublic_testdaten.csv"))).toMatchObject({ ok: true, bank: "trade_republic" });
  });

  it("reads an ING export in Windows-1252", () => {
    const text = readFileSync(new URL("../../../test-data/ing_testdaten.csv", import.meta.url), "utf8");
    const latin1 = new Uint8Array([...text].map((char) => char.charCodeAt(0)));
    expect(parseBankFile(latin1)).toMatchObject({ ok: true, bank: "ing", rows: { length: 29 } });
  });

  it("rejects unknown files", () => {
    expect(parseBankFile(new TextEncoder().encode("a;b;c\n1;2;3"))).toEqual({ ok: false, reason: "unknown-format" });
  });

  it("passes decoding errors on", () => {
    expect(parseBankFile(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
  });
});
