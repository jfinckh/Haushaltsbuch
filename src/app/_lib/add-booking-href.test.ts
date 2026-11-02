import { describe, expect, it } from "vitest";
import { addBookingHref, showAddBooking } from "./add-booking-href";

const parse = (href: string) => {
  const url = new URL(href, "http://app.invalid");
  return { path: url.pathname, accountId: url.searchParams.get("accountId"), back: url.searchParams.get("back") };
};

describe("addBookingHref", () => {
  it("preselects the overview's account and returns there", () => {
    expect(parse(addBookingHref("/", "account=a1"))).toEqual({ path: "/transactions/new", accountId: "a1", back: "/?account=a1" });
  });

  it("keeps the bookings list's filters as return address", () => {
    expect(parse(addBookingHref("/transactions", "account=a1&month=2026-10"))).toEqual({
      path: "/transactions/new",
      accountId: "a1",
      back: "/transactions?account=a1&month=2026-10",
    });
  });

  it("takes the account from an account page", () => {
    expect(parse(addBookingHref("/accounts/a2", ""))).toEqual({ path: "/transactions/new", accountId: "a2", back: "/accounts/a2" });
  });

  it("preselects no account for all my accounts", () => {
    expect(parse(addBookingHref("/", "account=all"))).toEqual({ path: "/transactions/new", accountId: null, back: "/?account=all" });
  });

  it("gives no return address for statistics (not a list page)", () => {
    expect(parse(addBookingHref("/statistics", "account=a1"))).toEqual({ path: "/transactions/new", accountId: "a1", back: null });
  });

  it("is the plain form without account or return address", () => {
    expect(addBookingHref("/statistics/year", "")).toBe("/transactions/new");
  });
});

describe("showAddBooking", () => {
  it.each(["/", "/transactions", "/accounts/a1", "/statistics", "/statistics/year", "/statistics/merchants"])("shows on %s", (path) => {
    expect(showAddBooking(path)).toBe(true);
  });

  it.each(["/transactions/new", "/transactions/t1", "/accounts/new", "/accounts/a1/edit", "/rules", "/categories", "/household", "/imports"])(
    "hides on %s",
    (path) => {
      expect(showAddBooking(path)).toBe(false);
    },
  );
});
