import { describe, expect, it } from "vitest";
import { formatIban, isValidIban, normalizeIban } from "./iban";

describe("IBAN", () => {
  it("normalizes spaces and case", () => {
    expect(normalizeIban(" de89 3704 0044\t0532 0130 00 ")).toBe("DE89370400440532013000");
  });

  it.each(["DE89370400440532013000", "GB82WEST12345698765432", "NL91ABNA0417164300", "AT611904300234573201"])(
    "accepts %s",
    (iban) => {
      expect(isValidIban(iban)).toBe(true);
    },
  );

  it.each([
    "DE89370400440532013001", // wrong check digits
    "DE8937040044053201300", // too short for the check
    "DE",
    "",
    "1289370400440532013000",
    "DE89 3704 0044 0532 0130 00", // not normalized
    "DE89370400440532013000!",
  ])("rejects %j", (iban) => {
    expect(isValidIban(iban)).toBe(false);
  });

  it("formats in groups of four", () => {
    expect(formatIban("DE89370400440532013000")).toBe("DE89 3704 0044 0532 0130 00");
    expect(formatIban("NL91ABNA0417164300")).toBe("NL91 ABNA 0417 1643 00");
  });
});
