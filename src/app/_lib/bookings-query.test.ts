import { describe, expect, it } from "vitest";
import { sanitizeBookingsQuery } from "./bookings-query";

const OWN = "c_0b9a1c1e-1111-4222-8333-444455556666";
const PERSONAL = "c_0b9a1c1e-aaaa-4bbb-8ccc-ddddeeeeffff";
const group = (key: string, subs: string[] = []) => ({ key, subcategories: subs.map((s) => ({ key: s })) });
const catalog = {
  names: { [OWN]: "Hobby", [PERSONAL]: "Mine" } as Record<string, string>,
  shared: [group("groceries", ["groceries.supermarket"]), group(OWN)],
  private: [group("groceries", ["groceries.supermarket"]), group(OWN), group(PERSONAL)],
};
const run = (raw: Record<string, string>, sharedAccount = false) => sanitizeBookingsQuery(raw, { catalog, sharedAccount });

describe("sanitizeBookingsQuery", () => {
  it("drops malformed periods so the page falls back to the current month", () => {
    expect(run({ month: "2026-13" }).values.month).toBeUndefined();
    expect(run({ year: "1969" }).values.year).toBeUndefined();
    expect(run({ year: "abcd" }).values.year).toBeUndefined();
    expect(run({ year: "2026" }).values.year).toBe("2026");
    expect(run({ month: "2026-10" }).values.month).toBe("2026-10");
  });

  it("keeps one period: month, then year, then range", () => {
    expect(run({ month: "2026-10", year: "2026" }).values).toEqual({ month: "2026-10" });
    expect(run({ year: "2026", from: "2026-01-01" }).values).toEqual({ year: "2026" });
    expect(run({ month: "2026-13", year: "2026" }).values).toEqual({ year: "2026" });
  });

  it("keeps ranges as they are, also reversed or one-sided; drops malformed days", () => {
    expect(run({ from: "2026-10-10", to: "2026-10-01" }).values).toEqual({ from: "2026-10-10", to: "2026-10-01" });
    expect(run({ from: "2026-10-10" }).values).toEqual({ from: "2026-10-10" });
    expect(run({ from: "2026-02-31", to: "2026-03-01" }).values).toEqual({ to: "2026-03-01" });
  });

  it("keeps only a valid kind", () => {
    expect(run({ kind: "foo" }).values.kind).toBeUndefined();
    expect(run({ kind: "saving" }).values.kind).toBe("saving");
  });

  it("takes a limit from 1 to 5000, else 200", () => {
    for (const limit of ["0", "99999", "abc", ""]) expect(run({ limit }).limit).toBe(200);
    expect(run({ limit: "400" }).limit).toBe(400);
    expect(run({ limit: "5000" }).limit).toBe(5000);
    expect(run({}).limit).toBe(200);
  });

  it("keeps standard keys also when hidden, none and known own keys; drops unknown keys", () => {
    expect(run({ category: "housing.rent" }).values.category).toBe("housing.rent");
    expect(run({ category: "none" }).values.category).toBe("none");
    expect(run({ category: OWN }).values.category).toBe(OWN);
    expect(run({ category: "no such key!" }).values.category).toBeUndefined();
    expect(run({ category: "c_00000000-0000-4000-8000-000000000000" }).values.category).toBeUndefined();
  });

  it("drops a personal own category on a shared account", () => {
    expect(run({ category: PERSONAL }, true).values.category).toBeUndefined();
    expect(run({ category: PERSONAL }, false).values.category).toBe(PERSONAL);
    expect(run({ category: OWN }, true).values.category).toBe(OWN);
  });

  it("keeps the search text and leaves out empty values", () => {
    expect(run({ q: "rewe", month: "" }).values).toEqual({ q: "rewe" });
  });
});
