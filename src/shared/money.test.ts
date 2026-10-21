import { describe, expect, it } from "vitest";
import { formatCents, formatEuro, germanAmountSchema, parseGermanAmount } from "./money";

describe("parseGermanAmount", () => {
  it.each([
    ["0", 0],
    ["12", 1200],
    ["12,5", 1250],
    ["12,50", 1250],
    ["0,01", 1],
    ["1.234,56", 123456],
    ["1234,56", 123456],
    ["1.234", 123400],
    ["1.234.567,89", 123456789],
    ["703,26", 70326],
    ["007,10", 710],
  ])("reads %s as %i cents", (input, cents) => {
    expect(parseGermanAmount(input)).toBe(cents);
  });

  it.each([
    ["-12,50", -1250],
    ["−1.000,00", -100000],
    ["- 3,5", -350],
    ["+3,50", 350],
  ])("reads the sign of %s", (input, cents) => {
    expect(parseGermanAmount(input)).toBe(cents);
  });

  it("accepts surrounding whitespace and a euro sign", () => {
    expect(parseGermanAmount("  1.234,56 € ")).toBe(123456);
    expect(parseGermanAmount("3€")).toBe(300);
  });

  it("never returns negative zero", () => {
    expect(Object.is(parseGermanAmount("-0,00"), 0)).toBe(true);
  });

  it.each([
    "",
    " ",
    "abc",
    "12a",
    "12.5", // dot as decimal separator
    "12.34",
    "1.23.456",
    "1234.567",
    ".5",
    ",5",
    "1,234",
    "1,2,3",
    "1.234,56,7",
    "--5",
    "5-",
    "€ 5",
    "1e3",
    "12 34",
    "99999999999999999999",
  ])("rejects %j", (input) => {
    expect(parseGermanAmount(input)).toBeNull();
  });

  it("stays exact where floats would not", () => {
    expect(parseGermanAmount("0,10")! + parseGermanAmount("0,20")!).toBe(30);
    expect(parseGermanAmount("90.071.992.547.409,91")).toBe(9007199254740991);
  });
});

describe("formatCents", () => {
  it.each([
    [0, "0,00"],
    [1, "0,01"],
    [99, "0,99"],
    [100, "1,00"],
    [123456, "1.234,56"],
    [100000000, "1.000.000,00"],
    [-1250, "-12,50"],
    [-5, "-0,05"],
  ])("formats %i as %s", (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });

  it("rejects non-integers", () => {
    expect(() => formatCents(1.5)).toThrow(RangeError);
  });

  it("round-trips with the parser", () => {
    for (const cents of [0, 1, -1, 70326, -123456789, 9007199254740991]) {
      expect(parseGermanAmount(formatCents(cents))).toBe(cents);
    }
  });

  it("formats euros", () => {
    expect(formatEuro(-5000)).toBe("-50,00 €");
  });
});

describe("germanAmountSchema", () => {
  it("turns text into cents", () => {
    expect(germanAmountSchema.parse("1.234,56")).toBe(123456);
  });

  it("rejects invalid text", () => {
    expect(germanAmountSchema.safeParse("12.5").success).toBe(false);
  });
});
