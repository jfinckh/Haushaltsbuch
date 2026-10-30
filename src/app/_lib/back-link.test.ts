import { describe, expect, it } from "vitest";
import { safeBack, safeOrigin } from "./back-link";

describe("safeBack", () => {
  it.each([
    "/",
    "/?account=all",
    "/transactions",
    "/transactions?account=all&month=2026-10&kind=expense",
    "/accounts/a1",
    "/accounts/a1?month=2026-10&q=edeka",
  ])("accepts %s", (value) => {
    expect(safeBack(value)).toBe(value);
  });

  it.each([
    undefined,
    "",
    "//evil.example",
    "https://evil.example",
    "/\\evil",
    "/statistics",
    "/accounts",
    "/accounts/a1/edit",
    "javascript:alert(1)",
    `/transactions?q=${"a".repeat(1001)}`,
    "/\t/evil",
    "/\n/evil",
    "/%2F%2Fevil",
  ])("refuses %s", (value) => {
    expect(safeBack(value)).toBeNull();
  });

  it("normalizes dot segments", () => {
    expect(safeBack("/accounts/x/../..")).toBe("/");
  });

  it("accepts the addresses the lists build", () => {
    const bookings = `/transactions?${new URLSearchParams({ account: "all", month: "2026-10", kind: "expense", category: "c_1", q: "Ä&b=c/d", limit: "400" })}`;
    expect(safeBack(bookings)).toBe(bookings);
    const account = `/accounts/a1?${new URLSearchParams({ month: "2026-10", q: "edeka" })}`;
    expect(safeBack(account)).toBe(account);
    expect(safeBack(encodeURIComponent(bookings))).toBeNull();
  });

  it("takes the first element of a list", () => {
    expect(safeBack(["/", "/transactions"])).toBe("/");
    expect(safeBack(["https://evil.example", "/"])).toBeNull();
  });
});

describe("safeOrigin", () => {
  it.each(["/", "/?account=all", "/statistics", "/statistics?account=a1&month=2026-10&compare=2026-09,2026-08", "/statistics/year?account=all&year=2026", "/statistics/merchants?account=a1&period=month&month=2026-10"])(
    "accepts %s",
    (value) => {
      expect(safeOrigin(value)).toBe(value);
    },
  );

  it.each([undefined, "", "//evil.example", "https://evil.example", "/transactions", "/statistics/other", "/statisticsx", "/accounts/a1", "/\\evil"])(
    "refuses %s",
    (value) => {
      expect(safeOrigin(value)).toBeNull();
    },
  );
});
