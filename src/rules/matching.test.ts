import { describe, expect, it } from "vitest";
import { normalizeText, pickRule, ruleMatches, type MatchableRule } from "./matching";

const rule = (overrides: Partial<MatchableRule> = {}): MatchableRule => ({
  id: "r",
  level: "account",
  counterparty: null,
  reference: null,
  amountSign: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const booking = (overrides: Partial<{ counterparty: string | null; reference: string | null; amountCents: number }> = {}) => ({
  counterparty: "VISA REWE MARKT GMBH",
  reference: "NR XXXX 1234 STUTTGART DE KAUFUMSATZ",
  amountCents: -5472,
  ...overrides,
});

describe("normalizing texts", () => {
  it("trims, collapses whitespace and ignores case", () => {
    expect(normalizeText("  VISA   REWE\tMarkt ")).toBe("visa rewe markt");
    expect(normalizeText("ÄRZTE")).toBe("ärzte");
  });
});

describe("whether a rule fits a booking", () => {
  it("matches a counterparty that contains the pattern, whatever the case and spacing", () => {
    expect(ruleMatches(rule({ counterparty: "rewe  markt" }), booking())).toBe(true);
    expect(ruleMatches(rule({ counterparty: "edeka" }), booking())).toBe(false);
  });

  it("matches the reference, e.g. a merchant behind PayPal", () => {
    const paypal = booking({
      counterparty: "PayPal Europe S.a.r.l. et Cie S.C.A",
      reference: "1000000000001/PP.1234.PP/. Spotify AB, Ihr Einkauf bei Spotify AB",
    });
    expect(ruleMatches(rule({ reference: "spotify" }), paypal)).toBe(true);
    expect(ruleMatches(rule({ counterparty: "spotify" }), paypal)).toBe(false);
  });

  it("needs both patterns when both are given", () => {
    const both = rule({ counterparty: "max mustermann", reference: "miete und co" });
    expect(ruleMatches(both, booking({ counterparty: "Max Mustermann", reference: "Miete und co" }))).toBe(true);
    expect(ruleMatches(both, booking({ counterparty: "Max Mustermann", reference: null }))).toBe(false);
  });

  it("checks the sign of the amount when the rule names it", () => {
    expect(ruleMatches(rule({ counterparty: "rewe", amountSign: "negative" }), booking())).toBe(true);
    expect(ruleMatches(rule({ counterparty: "rewe", amountSign: "positive" }), booking())).toBe(false);
    expect(ruleMatches(rule({ counterparty: "rewe", amountSign: "positive" }), booking({ amountCents: 500 }))).toBe(true);
  });

  it("never matches a rule without any pattern, or a booking without the text", () => {
    expect(ruleMatches(rule(), booking())).toBe(false);
    expect(ruleMatches(rule({ counterparty: "rewe" }), booking({ counterparty: null }))).toBe(false);
  });
});

describe("which rule wins", () => {
  it("prefers an account rule over a private one over a shared one", () => {
    const shared = rule({ id: "shared", level: "shared", counterparty: "rewe", updatedAt: "2026-10-20T00:00:00.000Z" });
    const own = rule({ id: "private", level: "private", counterparty: "rewe", updatedAt: "2026-10-10T00:00:00.000Z" });
    const account = rule({ id: "account", level: "account", counterparty: "rewe", updatedAt: "2026-10-01T00:00:00.000Z" });
    expect(pickRule([shared, own, account], booking())?.id).toBe("account");
    expect(pickRule([shared, own], booking())?.id).toBe("private");
  });

  it("takes the most recently changed rule within a level, and none when nothing fits", () => {
    const older = rule({ id: "older", counterparty: "rewe" });
    const newer = rule({ id: "newer", reference: "kaufumsatz", updatedAt: "2026-10-05T00:00:00.000Z" });
    expect(pickRule([older, newer], booking())?.id).toBe("newer");
    expect(pickRule([rule({ counterparty: "aral" })], booking())).toBeNull();
  });
});
