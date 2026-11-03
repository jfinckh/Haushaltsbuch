import { describe, expect, it } from "vitest";
import { findSuggestions, normalizeCounterparty, seriesDateOnOrAfter, type SuggestionBooking } from "./suggestions";

const TODAY = "2026-11-03";

let nextId = 0;
const booking = (date: string, amountCents = -1399, overrides: Partial<SuggestionBooking> = {}): SuggestionBooking => ({
  id: `b${nextId++}`,
  accountId: "shared",
  date,
  amountCents,
  kind: amountCents < 0 ? "expense" : "income",
  category: null,
  counterparty: "Netflix",
  ...overrides,
});

const find = (bookings: SuggestionBooking[], options: Partial<Parameters<typeof findSuggestions>[1]> = {}) =>
  findSuggestions(bookings, { today: TODAY, skip: () => false, templateBookingIds: new Set(), ...options });

describe("findSuggestions", () => {
  it("suggests a monthly subscription", () => {
    expect(find([booking("2026-08-15"), booking("2026-09-15"), booking("2026-10-15")])).toEqual([
      {
        accountId: "shared",
        counterparty: "Netflix",
        kind: "expense",
        category: null,
        amountCents: -1399,
        intervalMonths: 1,
        count: 3,
        lastDate: "2026-10-15",
        nextDueDate: "2026-11-15",
      },
    ]);
  });

  it("accepts a few days of drift", () => {
    const found = find([booking("2026-08-01"), booking("2026-09-03"), booking("2026-09-30"), booking("2026-11-01")]);
    expect(found.map((s) => s.intervalMonths)).toEqual([1]);
  });

  it("rejects two subscriptions in one month", () => {
    const dates = ["2026-08-05", "2026-08-20", "2026-09-05", "2026-09-20", "2026-10-05", "2026-10-20"];
    expect(find(dates.map((d) => booking(d)))).toEqual([]);
  });

  it("rejects amounts that vary more than 10 %", () => {
    const salary = (amount: number) => [booking("2026-08-28", 300000), booking("2026-09-28", 300000), booking("2026-10-28", amount)];
    expect(find(salary(330000))).toEqual([]);
    expect(find(salary(305000))).toHaveLength(1);
  });

  it("accepts 6.7 % (3.200 on 3.000)", () => {
    expect(find([booking("2026-08-28", 300000), booking("2026-09-28", 300000), booking("2026-10-28", 320000)])).toHaveLength(1);
  });

  it("looks only at the latest run after a price rise", () => {
    const found = find([
      booking("2026-04-15", -999),
      booking("2026-05-15", -999),
      booking("2026-06-15", -999),
      booking("2026-07-15", -1399),
      booking("2026-08-15", -1399),
      booking("2026-09-15", -1399),
      booking("2026-10-15", -1399),
    ]);
    expect(found).toMatchObject([{ count: 4, amountCents: -1399, intervalMonths: 1 }]);
  });

  it("looks only at the latest run after a skipped month", () => {
    const dates = ["2026-03-15", "2026-04-15", "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15"];
    expect(find(dates.map((d) => booking(d)))).toMatchObject([{ count: 5, intervalMonths: 1 }]);
  });

  it("suggests quarterly", () => {
    expect(find([booking("2026-02-10"), booking("2026-05-11"), booking("2026-08-09")])).toMatchObject([
      { intervalMonths: 3, nextDueDate: "2026-11-09" },
    ]);
  });

  it("suggests yearly from two bookings", () => {
    expect(find([booking("2024-12-10", -45000), booking("2025-12-12", -45000)])).toMatchObject([
      { intervalMonths: 12, count: 2, nextDueDate: "2026-12-12" },
    ]);
  });

  it("needs three bookings for monthly", () => {
    expect(find([booking("2026-09-15"), booking("2026-10-15")])).toEqual([]);
  });

  it("drops stale series", () => {
    expect(find([booking("2026-05-15"), booking("2026-06-15"), booking("2026-07-15")])).toEqual([]);
  });

  it("groups by account, counterparty and type", () => {
    const dates = ["2026-08-15", "2026-09-15", "2026-10-15"];
    const found = find([
      ...dates.map((d) => booking(d, -1399, { counterparty: "NETFLIX " })),
      ...dates.map((d) => booking(d, -1399, { accountId: "other" })),
    ]);
    expect(found.map((s) => [s.accountId, s.counterparty])).toEqual([
      ["other", "Netflix"],
      ["shared", "NETFLIX "],
    ]);
  });

  it("uses the newest booking's counterparty, category and amount", () => {
    const found = find([
      booking("2026-08-15", -1299, { counterparty: "NETFLIX" }),
      booking("2026-09-15", -1299, { counterparty: "NETFLIX" }),
      booking("2026-10-15", -1399, { counterparty: "Netflix", category: "leisure.subscriptions" }),
    ]);
    expect(found[0]).toMatchObject({ counterparty: "Netflix", category: "leisure.subscriptions", amountCents: -1399 });
  });

  it("skips what skip() says", () => {
    const dates = ["2026-08-15", "2026-09-15", "2026-10-15"];
    expect(find(dates.map((d) => booking(d)), { skip: (accountId, counterparty) => accountId === "shared" && counterparty === "netflix" })).toEqual([]);
  });

  it("skips groups with template bookings", () => {
    const bookings = ["2026-08-15", "2026-09-15", "2026-10-15"].map((d) => booking(d));
    expect(find(bookings, { templateBookingIds: new Set([bookings[1].id]) })).toEqual([]);
  });

  it("ignores bookings without counterparty", () => {
    expect(find(["2026-08-15", "2026-09-15", "2026-10-15"].map((d) => booking(d, -1399, { counterparty: null })))).toEqual([]);
  });

  it("lists the newest last date first", () => {
    const found = find([
      ...["2026-08-01", "2026-09-01", "2026-10-01"].map((d) => booking(d, -999, { counterparty: "Spotify" })),
      ...["2026-08-15", "2026-09-15", "2026-10-15"].map((d) => booking(d)),
    ]);
    expect(found.map((s) => s.counterparty)).toEqual(["Netflix", "Spotify"]);
  });
});

describe("helpers", () => {
  it("normalizes counterparties", () => {
    expect(normalizeCounterparty("  NETFLIX   International ")).toBe("netflix international");
  });

  it("finds the next series date", () => {
    expect(seriesDateOnOrAfter("2026-01-31", 1, "2026-02-01")).toBe("2026-02-28");
    expect(seriesDateOnOrAfter("2026-08-09", 3, "2026-11-03")).toBe("2026-11-09");
    expect(seriesDateOnOrAfter("2026-10-15", 1, "2026-10-15")).toBe("2026-10-15");
  });
});
