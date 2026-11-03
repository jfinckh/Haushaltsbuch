import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "./test-utils";

// recurring_due_after (drizzle/0029_recurring_functions.sql): the first date of a template's series
// on or after a day. The series starts in the anchor's month and steps by the interval; each date is
// the template's day, or the month's last day when the month is shorter.

let setup: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  setup = await createTestDatabase();
});

async function dueAfter(day: number, interval: number, anchor: string, from: string): Promise<string> {
  const [row] = await setup.query<{ due: string }>(
    sql`SELECT recurring_due_after(${day}::int, ${interval}::int, ${anchor}::date, ${from}::date)::text AS due`,
  );
  return row.due;
}

describe("recurring_due_after", () => {
  it("uses the last day of a shorter month", async () => {
    expect(await dueAfter(31, 1, "2026-01-31", "2026-02-01")).toBe("2026-02-28");
  });

  it("knows leap years", async () => {
    expect(await dueAfter(31, 1, "2028-01-31", "2028-02-01")).toBe("2028-02-29");
  });

  it("comes back to the day after a short month", async () => {
    expect(await dueAfter(31, 1, "2026-01-31", "2026-03-01")).toBe("2026-03-31");
  });

  it("steps by the interval", async () => {
    expect(await dueAfter(15, 3, "2026-01-15", "2026-01-16")).toBe("2026-04-15");
  });

  it("counts the start day itself", async () => {
    expect(await dueAfter(15, 12, "2026-01-15", "2026-01-15")).toBe("2026-01-15");
  });

  it("jumps over many periods at once", async () => {
    expect(await dueAfter(1, 6, "2026-01-01", "2026-11-03")).toBe("2027-01-01");
  });
});
