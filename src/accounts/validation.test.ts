import { describe, expect, it } from "vitest";
import { createAccountSchema, createTradeRepublicSchema, defaultRole, TYPES_BY_BANK, updateAccountSchema } from "./validation";

describe("account input", () => {
  it("parses the form's text into an account", () => {
    expect(
      createAccountSchema.parse({
        name: " ING Giro ",
        bank: "ing",
        type: "checking",
        visibility: "private",
        openingBalance: "-1.234,5",
        iban: "de89 3704 0044 0532 0130 00",
      }),
    ).toEqual({
      name: "ING Giro",
      bank: "ing",
      type: "checking",
      role: "everyday",
      visibility: "private",
      openingBalanceCents: -123450,
      iban: "DE89370400440532013000",
    });
  });

  it("treats an empty IBAN as none", () => {
    const parsed = createAccountSchema.parse({ name: "A", bank: "other", type: "savings", visibility: "shared", openingBalance: "0", iban: " " });
    expect(parsed).toMatchObject({ iban: null, role: "savings" });
  });

  it("starts a new account at 0 € without an opening balance", () => {
    expect(createAccountSchema.parse({ name: "A", bank: "ing", type: "checking", visibility: "private" })).toMatchObject({ openingBalanceCents: 0 });
    expect(createTradeRepublicSchema.parse({ setup: "trade-republic", visibility: "shared" })).toMatchObject({
      clearingOpeningBalance: 0,
      depotOpeningBalance: 0,
    });
  });

  it("names the field of each error", () => {
    const result = createAccountSchema.safeParse({ name: "", bank: "cash", type: "depot", visibility: "x", openingBalance: "1.2" });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((issue) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["name", "visibility", "openingBalance"]));
  });

  it("knows which types each bank offers", () => {
    expect(TYPES_BY_BANK.trade_republic).toEqual(["clearing", "depot"]);
    expect(TYPES_BY_BANK.cash).toEqual(["cash"]);
    expect(defaultRole("depot")).toBe("savings");
    expect(defaultRole("clearing")).toBe("everyday");
  });

  it("parses a Trade Republic setup", () => {
    expect(
      createTradeRepublicSchema.parse({
        setup: "trade-republic",
        visibility: "private",
        clearingOpeningBalance: "1,00",
        depotOpeningBalance: "0",
      }),
    ).toEqual({ setup: "trade-republic", visibility: "private", clearingOpeningBalance: 100, depotOpeningBalance: 0 });
  });

  it("parses partial updates", () => {
    expect(updateAccountSchema.parse({ archived: true, iban: null })).toEqual({ archived: true, iban: null });
    expect(updateAccountSchema.safeParse({ openingBalance: "12.5" }).success).toBe(false);
  });
});
