import { describe, expect, it } from "vitest";
import { currentBalances } from "./balances";

describe("currentBalances", () => {
  it("adds each account's bookings to its opening balance", () => {
    const accounts = [
      { id: "giro", openingBalanceCents: 10000 },
      { id: "cash", openingBalanceCents: 500 },
    ];
    expect(currentBalances(accounts, { giro: -2500, other: 99 })).toEqual({ giro: 7500, cash: 500 });
  });
});
