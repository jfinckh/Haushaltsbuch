import { describe, expect, it } from "vitest";
import { transferSignals } from "./signals";

const members = [
  { userId: "max", name: "Max Mustermann" },
  { userId: "erika", name: "Erika Mustermann" },
];
const index = (iban: string) => `idx:${iban}`;
const booking = (overrides: Partial<{ counterparty: string | null; counterpartyIban: string | null; reference: string | null }>) => ({
  counterparty: null,
  counterpartyIban: null,
  reference: null,
  ...overrides,
});

describe("transfer hints of a booking", () => {
  it("finds Trade Republic named in the counterparty or the reference", () => {
    expect(transferSignals(booking({ counterparty: "Trade Republic" }), members, index)).toEqual({
      mentionedIbanIndex: null,
      mentionedBank: "trade_republic",
      counterpartyMemberId: null,
    });
    expect(transferSignals(booking({ reference: "Lastschrift TRADE  REPUBLIC 1a2b" }), members, index)?.mentionedBank).toBe(
      "trade_republic",
    );
  });

  it("takes the counterparty IBAN, normalized", () => {
    expect(transferSignals(booking({ counterpartyIban: "DE94 1234 5678 1111 1111 11" }), members, index)?.mentionedIbanIndex).toBe(
      "idx:DE94123456781111111111",
    );
  });

  it("finds a valid IBAN in the text (Trade Republic top-up)", () => {
    const signals = transferSignals(booking({ reference: "Direct Debit Top up with DE94123456781111111111" }), members, index);
    expect(signals?.mentionedIbanIndex).toBe("idx:DE94123456781111111111");
  });

  it("ignores IBAN-like text with wrong check digits", () => {
    expect(transferSignals(booking({ reference: "Top up with DE00123456781111111111" }), members, index)).toBeNull();
  });

  it("finds a member's name as counterparty, ignoring case and spaces", () => {
    expect(transferSignals(booking({ counterparty: "  max   MUSTERMANN " }), members, index)?.counterpartyMemberId).toBe("max");
    expect(transferSignals(booking({ counterparty: "Erika Mustermann" }), members, index)?.counterpartyMemberId).toBe("erika");
    expect(transferSignals(booking({ counterparty: "Kind Mustermann" }), members, index)).toBeNull();
  });

  it("finds nothing in ordinary bookings such as ING fees", () => {
    expect(transferSignals(booking({ counterparty: "ING", reference: "GIROCARD MONATLICHES ENTGELT" }), members, index)).toBeNull();
    expect(transferSignals(booking({ counterparty: "VISA REWE MARKT GMBH" }), members, index)).toBeNull();
  });
});
