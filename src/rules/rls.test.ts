import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withSession } from "@/shared/rls";
import { bookingRule } from "./schema";
import { createTestDatabase } from "./test-utils";

// The database itself shows each member only the rules they may see: rules of visible accounts, the
// household's shared rules and their own private rules.

type Setup = Awaited<ReturnType<typeof createTestDatabase>>;

let setup: Setup;

const rule = (id: string, scope: { accountId?: string; householdId?: string; ownerUserId?: string }, createdBy = "max") => ({
  id,
  accountId: scope.accountId ?? null,
  householdId: scope.householdId ?? null,
  ownerUserId: scope.ownerUserId ?? null,
  counterpartyPatternEncrypted: "x",
  resultKind: "expense" as const,
  createdByUserId: createdBy,
});

beforeEach(async () => {
  setup = await createTestDatabase();
  await setup.householdOf("home", "max", "erika");
  await setup.householdOf("other", "dora");
  await setup.addAccount("max-ing", "max");
  await setup.addAccount("shared", "max", "home");
  await setup.addAccount("dora-shared", "dora", "other");
  // Owner connection: rows straight into the table, past row-level security.
  await setup.db.insert(bookingRule).values([
    rule("on-private", { accountId: "max-ing" }),
    rule("on-shared", { accountId: "shared" }),
    rule("household", { householdId: "home" }),
    rule("max-own", { ownerUserId: "max" }),
    rule("dora-household", { householdId: "other" }, "dora"),
  ]);
});

async function asUser<T>(userId: string, fn: Parameters<typeof withSession<T>>[2]) {
  return withSession(setup.db, await setup.as(userId), fn);
}

const visibleIds = (userId: string) =>
  asUser(userId, async (tx) => (await tx.select({ id: bookingRule.id }).from(bookingRule)).map((r) => r.id).sort());

describe("row-level security on booking_rule", () => {
  it("returns only the rules each member may see, even without a filter", async () => {
    expect(await visibleIds("max")).toEqual(["household", "max-own", "on-private", "on-shared"]);
    expect(await visibleIds("erika")).toEqual(["household", "on-shared"]);
    expect(await visibleIds("dora")).toEqual(["dora-household"]);
  });

  it("does not let another member change or delete private rules", async () => {
    for (const statement of [
      sql`UPDATE booking_rule SET result_kind = 'income' WHERE id IN ('on-private', 'max-own')`,
      sql`DELETE FROM booking_rule WHERE id IN ('on-private', 'max-own')`,
    ]) {
      const result = (await asUser("erika", (tx) => tx.execute(statement))) as unknown as { rowCount: number | null; affectedRows?: number };
      expect(result.affectedRows ?? result.rowCount).toBe(0);
    }
    expect(await visibleIds("max")).toContain("max-own");
  });

  it("does not let anyone create rules for others, other households or invisible accounts", async () => {
    for (const values of [
      rule("a", { ownerUserId: "max" }, "erika"),
      rule("b", { householdId: "other" }, "erika"),
      rule("c", { accountId: "max-ing" }, "erika"),
      rule("d", { householdId: "home" }, "max"),
    ]) {
      await expect(asUser("erika", (tx) => tx.insert(bookingRule).values(values))).rejects.toThrow();
    }
  });

  it("does not let a member move a rule into a scope they cannot see", async () => {
    await expect(
      asUser("erika", (tx) => tx.execute(sql`UPDATE booking_rule SET household_id = NULL, account_id = 'max-ing' WHERE id = 'household'`)),
    ).rejects.toThrow();
  });
});
