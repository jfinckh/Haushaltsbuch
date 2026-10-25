import { describe, expect, it } from "vitest";
import { findSuggestions, type SuggestionBooking } from "./suggestions";

let next = 0;
const booking = (counterparty: string | null, reference: string | null = null, extra: Partial<SuggestionBooking> = {}): SuggestionBooking => ({
  id: `b${next++}`,
  accountId: "ing",
  amountCents: -1000,
  counterparty,
  reference,
  ...extra,
});

const card = (shop: string, day: number) =>
  booking(`VISA ${shop}`, `NR XXXX 1234 STUTTGART DE KAUFUMSATZ ${day}.10 35,06 101016 ARN0000000000000000000000${day} Apple Pay`);

const paypal = (shop: string, n: number) =>
  booking("PayPal Europe S.a.r.l. et Cie S.C.A", `100000000000${n}/PP.1234.PP/. ${shop}, Ihr Einkauf bei ${shop}`);

const none = () => false;

describe("findSuggestions", () => {
  it("suggests a counterparty that comes back at least 3 times, without card noise", () => {
    const result = findSuggestions([card("EDEKA MUSTERMARKT", 1), card("EDEKA MUSTERMARKT", 2), card("EDEKA MUSTERMARKT", 3)], none);
    expect(result).toEqual([
      {
        field: "counterparty",
        pattern: "EDEKA MUSTERMARKT",
        count: 3,
        example: "VISA EDEKA MUSTERMARKT",
        accountId: "ing",
        kind: "expense",
      },
    ]);
  });

  it("needs at least 3 bookings", () => {
    expect(findSuggestions([card("EDEKA MUSTERMARKT", 1), card("EDEKA MUSTERMARKT", 2)], none)).toEqual([]);
  });

  it("finds the shared first word of different branches", () => {
    const result = findSuggestions([card("EDEKA MUSTERMARKT", 1), card("EDEKA CENTER", 2), card("Edeka Mustermarkt", 3)], none);
    expect(result.map((s) => [s.field, s.pattern, s.count])).toEqual([["counterparty", "EDEKA", 3]]);
  });

  it("does not group different shops by a generic word", () => {
    const result = findSuggestions(
      [card("REWE MARKT GMBH", 1), card("DM DROGERIE MARKT", 2), card("ALDI MARKT", 3), card("NETTO MARKT", 4)],
      none,
    );
    expect(result).toEqual([]);
  });

  it("finds the shop behind PayPal in the reference", () => {
    const result = findSuggestions([paypal("EasyPark GmbH", 1), paypal("EasyPark GmbH", 2), paypal("EasyPark GmbH", 3), paypal("Spotify AB", 4)], none);
    expect(result).toEqual([
      expect.objectContaining({ field: "reference", pattern: "EasyPark", count: 3, example: "PayPal Europe S.a.r.l. et Cie S.C.A" }),
    ]);
  });

  it("ignores reference words shared by many different counterparties", () => {
    // STUTTGART is in every card reference, but the shops differ.
    const result = findSuggestions([card("EDEKA MUSTERMARKT", 1), card("REWE MARKT GMBH", 2), card("BAECKEREI MUSTERMEHL", 3)], none);
    expect(result).toEqual([]);
  });

  it("keeps a recurring reference of one counterparty, but not when the counterparty already suggests it", () => {
    const rent = [1, 2, 3].map(() => booking("Hausverwaltung Muster", "Miete und co"));
    expect(findSuggestions(rent, none).map((s) => [s.field, s.pattern])).toEqual([["counterparty", "Hausverwaltung Muster"]]);

    const fromPeople = [booking("Anna Muster", "Miete und co"), booking("Ben Muster", "Miete und co"), booking("Anna Muster", "Miete und co")];
    expect(findSuggestions(fromPeople, none).map((s) => [s.field, s.pattern])).toEqual([["reference", "Miete"]]);
  });

  it("leaves out hidden suggestions", () => {
    const bookings = [card("EDEKA MUSTERMARKT", 1), card("EDEKA MUSTERMARKT", 2), card("EDEKA MUSTERMARKT", 3)];
    expect(findSuggestions(bookings, (field, pattern) => field === "counterparty" && pattern === "edeka mustermarkt")).toEqual([]);
  });

  it("preselects the account with most bookings and the type by sign", () => {
    const result = findSuggestions(
      [
        booking("Musterfirma GmbH", "Gehalt", { amountCents: 300000, accountId: "shared" }),
        booking("Musterfirma GmbH", "Reisekosten", { amountCents: 5600, accountId: "ing" }),
        booking("Musterfirma GmbH", "Gehalt", { amountCents: 300000, accountId: "shared" }),
      ],
      none,
    );
    expect(result).toEqual([expect.objectContaining({ pattern: "Musterfirma", accountId: "shared", kind: "income" })]);
  });

  it("stops a pattern before legal forms and filler words", () => {
    const result = findSuggestions([1, 2, 3].map((d) => card("REWE MARKT GMBH", d)), none);
    expect(result.map((s) => s.pattern)).toEqual(["REWE MARKT"]);
  });

  it("orders by count and stops at the limit", () => {
    const bookings = [
      ...[1, 2, 3].map((d) => card("ARAL STATION", d)),
      ...[1, 2, 3, 4].map((d) => card("REWE MARKT GMBH", d)),
    ];
    expect(findSuggestions(bookings, none).map((s) => s.pattern)).toEqual(["REWE MARKT", "ARAL STATION"]);
    expect(findSuggestions(bookings, none, { limit: 1 }).map((s) => s.pattern)).toEqual(["REWE MARKT"]);
  });

  it("ignores bookings without texts", () => {
    expect(findSuggestions([booking(null), booking(null), booking(null)], none)).toEqual([]);
  });
});
