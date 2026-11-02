import { describe, expect, it } from "vitest";
import { countingMonthOf } from "./counting-month";

const salary = { kind: "income" as const, category: "salary" };

describe("countingMonthOf", () => {
  it("keeps salary before the 20th in its booking month", () => {
    expect(countingMonthOf({ ...salary, bookingDate: "2026-10-19" })).toBe("2026-10");
  });

  it("moves salary from the 20th on to the next month", () => {
    expect(countingMonthOf({ ...salary, bookingDate: "2026-10-20" })).toBe("2026-11");
    expect(countingMonthOf({ ...salary, bookingDate: "2026-10-31" })).toBe("2026-11");
  });

  it("moves December salary into January of the next year", () => {
    expect(countingMonthOf({ ...salary, bookingDate: "2026-12-22" })).toBe("2027-01");
  });

  it("moves salary subcategories too, but no other income or expenses", () => {
    expect(countingMonthOf({ kind: "income", category: "salary.c_bonus", bookingDate: "2026-10-30" })).toBe("2026-11");
    expect(countingMonthOf({ kind: "income", category: "otherIncome", bookingDate: "2026-10-30" })).toBe("2026-10");
    expect(countingMonthOf({ kind: "income", category: "salaryX", bookingDate: "2026-10-30" })).toBe("2026-10");
    expect(countingMonthOf({ kind: "expense", category: "salary", bookingDate: "2026-10-30" })).toBe("2026-10");
    expect(countingMonthOf({ kind: "income", category: null, bookingDate: "2026-10-30" })).toBe("2026-10");
  });

  it("follows a person's choice in both directions", () => {
    expect(countingMonthOf({ ...salary, bookingDate: "2026-10-30", countsNextMonth: false })).toBe("2026-10");
    expect(countingMonthOf({ kind: "expense", category: "housing", bookingDate: "2026-10-28", countsNextMonth: true })).toBe("2026-11");
    expect(countingMonthOf({ ...salary, bookingDate: "2026-10-30", countsNextMonth: null })).toBe("2026-11");
  });
});
