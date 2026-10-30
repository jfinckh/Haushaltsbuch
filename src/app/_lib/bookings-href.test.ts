import { describe, expect, it } from "vitest";
import { bookingsHref } from "./bookings-href";

describe("bookingsHref", () => {
  it("builds a month and category address", () => {
    expect(bookingsHref({ account: "all", month: "2026-10", kind: "expense", category: "groceries" })).toBe(
      "/transactions?account=all&month=2026-10&kind=expense&category=groceries",
    );
  });

  it("builds a year address and leaves out absent fields", () => {
    expect(bookingsHref({ account: "a1", year: 2026, kind: "income" })).toBe("/transactions?account=a1&year=2026&kind=income");
  });

  it("turns a null category into none", () => {
    expect(bookingsHref({ account: "a1", month: "2026-10", kind: "expense", category: null })).toBe(
      "/transactions?account=a1&month=2026-10&kind=expense&category=none",
    );
  });

  it("adds the page it was opened from", () => {
    const href = bookingsHref({ account: "a1", month: "2026-10", kind: "expense", category: "housing", origin: "/statistics?account=a1&month=2026-10" });
    expect(new URL(href, "http://x").searchParams.get("origin")).toBe("/statistics?account=a1&month=2026-10");
  });
});
