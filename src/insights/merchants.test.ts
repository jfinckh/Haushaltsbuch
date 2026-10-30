import { describe, expect, it } from "vitest";
import { merchantOf, rankMerchants, type MerchantBooking } from "./merchants";

const booking = (amountCents: number, counterparty: string | null, reference: string | null = null): MerchantBooking => ({
  amountCents,
  counterparty,
  reference,
});

describe("merchantOf", () => {
  it("drops the VISA prefix of ING card payments", () => {
    expect(merchantOf("VISA EDEKA MUSTERMARKT", "NR XXXX 1234 STUTTGART DE KAUFUMSATZ")).toEqual({
      key: "edeka mustermarkt",
      name: "EDEKA MUSTERMARKT",
    });
  });

  it("takes a PayPal purchase's merchant from the reference", () => {
    expect(
      merchantOf("PayPal Europe S.a.r.l. et Cie S.C.A", "1000000000002/PP.1234.PP/. EasyPark GmbH, Ihr Einkauf bei EasyPark GmbH"),
    ).toEqual({ key: "easypark", name: "EasyPark GmbH" });
  });

  it("keeps PayPal when the reference names no merchant", () => {
    expect(merchantOf("PayPal Europe S.a.r.l. et Cie S.C.A", "Rückzahlung")).toEqual({ key: "paypal", name: "PayPal" });
    expect(merchantOf("PayPal Europe S.a.r.l. et Cie S.C.A", null)).toEqual({ key: "paypal", name: "PayPal" });
  });

  it("ignores case, extra spaces and the legal form", () => {
    const keys = ["EasyPark GmbH", "easypark", "  EasyPark   GmbH & Co. KG ", "EASYPARK AG"].map((name) => merchantOf(name, null)?.key);
    expect(new Set(keys)).toEqual(new Set(["easypark"]));
    expect(merchantOf("  Fressnapf   Musterstadt ", null)?.name).toBe("Fressnapf Musterstadt");
  });

  it("keeps a name that is only a legal form", () => {
    expect(merchantOf("AG", null)).toEqual({ key: "ag", name: "AG" });
  });

  it("gives null without a name", () => {
    expect(merchantOf(null, "Bäcker")).toBeNull();
    expect(merchantOf("   ", null)).toBeNull();
    expect(merchantOf("VISA ", null)).toBeNull();
  });
});

describe("rankMerchants", () => {
  it("ranks merchants by spending, refunds lowering their merchant", () => {
    const ranking = rankMerchants(
      [
        booking(-3506, "VISA EDEKA MUSTERMARKT"),
        booking(-1200, "Edeka Mustermarkt"),
        booking(-693, "PayPal Europe S.a.r.l. et Cie S.C.A", "Ihr Einkauf bei EasyPark GmbH"),
        booking(-10000, "Shop"),
        booking(2500, "Shop"),
      ],
      [],
    );
    expect(ranking).toEqual({
      totalCents: 4706 + 693 + 7500,
      hasPrevious: false,
      merchants: [
        { key: "shop", name: "Shop", spentCents: 7500, purchases: 1, averageCents: 7500, previousCents: 0 },
        { key: "edeka mustermarkt", name: "EDEKA MUSTERMARKT", spentCents: 4706, purchases: 2, averageCents: 2353, previousCents: 0 },
        { key: "easypark", name: "EasyPark GmbH", spentCents: 693, purchases: 1, averageCents: 693, previousCents: 0 },
      ],
    });
  });

  it("shows the most frequent spelling, the newest one on a tie", () => {
    const { merchants } = rankMerchants([booking(-100, "Rewe"), booking(-100, "REWE GmbH"), booking(-100, "REWE GmbH"), booking(-100, "rewe")], []);
    expect(merchants.map((m) => m.name)).toEqual(["REWE GmbH"]);
    expect(rankMerchants([booking(-100, "Rewe"), booking(-100, "REWE")], []).merchants[0].name).toBe("Rewe");
  });

  it("leaves out merchants at zero or below", () => {
    const { merchants, totalCents } = rankMerchants([booking(-500, "A"), booking(500, "A"), booking(800, "B"), booking(-300, "C")], []);
    expect(merchants.map((m) => m.key)).toEqual(["c"]);
    expect(totalCents).toBe(300);
  });

  it("puts bookings without a name last, whatever they add up to", () => {
    const { merchants } = rankMerchants([booking(-9000, null), booking(-100, "A")], []);
    expect(merchants).toEqual([
      { key: "a", name: "A", spentCents: 100, purchases: 1, averageCents: 100, previousCents: 0 },
      { key: null, name: null, spentCents: 9000, purchases: 1, averageCents: 9000, previousCents: 0 },
    ]);
  });

  it("compares each merchant with the period before", () => {
    const ranking = rankMerchants([booking(-3000, "A"), booking(-1000, "B")], [booking(-1000, "a"), booking(-2000, "Old"), booking(500, "B")]);
    expect(ranking.hasPrevious).toBe(true);
    expect(ranking.merchants.map(({ key, previousCents }) => [key, previousCents])).toEqual([
      ["a", 1000],
      ["b", 0],
    ]);
  });

  it("orders equal amounts by name", () => {
    const { merchants } = rankMerchants([booking(-100, "Zoo"), booking(-100, "Apotheke")], []);
    expect(merchants.map((m) => m.name)).toEqual(["Apotheke", "Zoo"]);
  });
});
