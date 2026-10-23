import { describe, expect, it } from "vitest";
import { dayGap, proposeMerges, shiftDate } from "./merge";

const row = (line: number, date: string, amountCents = -2000) => ({ line, bookingDate: date, amountCents });
const booking = (id: string, date: string, amountCents = -2000) => ({ id, date, amountCents });

describe("dates", () => {
  it("counts days between plain dates and shifts them", () => {
    expect(dayGap("2026-10-01", "2026-09-28")).toBe(3);
    expect(dayGap("2026-03-01", "2026-02-28")).toBe(1);
    expect(shiftDate("2026-10-01", -3)).toBe("2026-09-28");
    expect(shiftDate("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("proposing merges", () => {
  it("merges a row with a booking of the same amount up to 3 days apart", () => {
    expect(proposeMerges([row(1, "2026-10-10")], [booking("a", "2026-10-07")])).toEqual(new Map([[1, "a"]]));
    expect(proposeMerges([row(1, "2026-10-10")], [booking("a", "2026-10-13")])).toEqual(new Map([[1, "a"]]));
  });

  it("proposes nothing 4 days apart or for another amount", () => {
    expect(proposeMerges([row(1, "2026-10-10")], [booking("a", "2026-10-06")]).size).toBe(0);
    expect(proposeMerges([row(1, "2026-10-10")], [booking("a", "2026-10-10", 2000)]).size).toBe(0);
  });

  it("takes the closest booking for a row", () => {
    const merges = proposeMerges([row(1, "2026-10-10")], [booking("far", "2026-10-12"), booking("near", "2026-10-09")]);
    expect(merges).toEqual(new Map([[1, "near"]]));
  });

  it("never merges one booking with two rows", () => {
    const merges = proposeMerges([row(1, "2026-10-12"), row(2, "2026-10-10")], [booking("a", "2026-10-10")]);
    expect(merges).toEqual(new Map([[2, "a"]]));
  });

  it("gives each row its own booking, closest pairs first", () => {
    const merges = proposeMerges(
      [row(1, "2026-10-10"), row(2, "2026-10-12")],
      [booking("a", "2026-10-11"), booking("b", "2026-10-14")],
    );
    // Row 1 and a are 1 day apart, row 2 and a too: row 1 wins (lower line); row 2 takes b (2 days).
    expect(merges).toEqual(new Map([[1, "a"], [2, "b"]]));
  });

  it("decides ties by line, then by the older booking, then by id", () => {
    expect(proposeMerges([row(1, "2026-10-10")], [booking("b", "2026-10-11"), booking("a", "2026-10-09")])).toEqual(
      new Map([[1, "a"]]),
    );
    expect(proposeMerges([row(1, "2026-10-10")], [booking("b", "2026-10-10"), booking("a", "2026-10-10")])).toEqual(
      new Map([[1, "a"]]),
    );
  });
});
