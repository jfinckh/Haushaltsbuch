import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { NoHouseholdError } from "./create-households";
import { householdMember } from "./schema";
import { createTestHouseholds } from "./test-utils";

type Setup = Awaited<ReturnType<typeof createTestHouseholds>>;

let setup: Setup;

beforeEach(async () => {
  setup = await createTestHouseholds();
});

describe("creating a household", () => {
  it("makes the user its first member, in EUR", async () => {
    const result = await setup.households.createHousehold("max", { name: "  Mustermann " });
    expect(result).toEqual({
      ok: true,
      household: { id: expect.any(String), name: "Mustermann", currency: "EUR", memberCount: 1 },
    });
    expect(await setup.households.getMembership("max")).toEqual({ householdId: result.ok && result.household.id });
  });

  it("allows only one household per user", async () => {
    await setup.households.createHousehold("max", { name: "First" });
    expect(await setup.households.createHousehold("max", { name: "Second" })).toEqual({
      ok: false,
      reason: "already-member",
    });
  });

  it("rejects invalid input", async () => {
    expect(await setup.households.createHousehold("max", { name: "" })).toEqual({ ok: false, reason: "invalid-input" });
    expect(await setup.households.getMembership("max")).toBeNull();
  });
});

describe("joining through an invite", () => {
  it("adds the invited user to the inviter's household", async () => {
    const created = await setup.households.createHousehold("max", { name: "Mustermann" });
    if (!created.ok) throw new Error("setup failed");

    const membership = await setup.households.joinInvitersHousehold("erika", "max");
    expect(membership).toEqual({ householdId: created.household.id });
    expect((await setup.households.getHousehold("erika"))?.memberCount).toBe(2);

    const [row] = await setup.db.select().from(householdMember).where(eqUser("erika"));
    expect(row.invitedByUserId).toBe("max");
  });

  it("is idempotent", async () => {
    await setup.households.createHousehold("max", { name: "Mustermann" });
    const first = await setup.households.joinInvitersHousehold("erika", "max");
    const second = await setup.households.joinInvitersHousehold("erika", "max");
    expect(second).toEqual(first);
    expect((await setup.households.getHousehold("max"))?.memberCount).toBe(2);
  });

  it("does nothing without an inviter or when the inviter has no household", async () => {
    expect(await setup.households.joinInvitersHousehold("erika", null)).toBeNull();
    expect(await setup.households.joinInvitersHousehold("erika", "max")).toBeNull();
    expect(await setup.households.getMembership("erika")).toBeNull();
  });

  it("keeps an existing household", async () => {
    await setup.households.createHousehold("max", { name: "Mustermann" });
    const own = await setup.households.createHousehold("erika", { name: "Erikas" });
    if (!own.ok) throw new Error("setup failed");
    expect(await setup.households.joinInvitersHousehold("erika", "max")).toEqual({ householdId: own.household.id });
  });
});

describe("requireMembership", () => {
  it("returns the membership or throws NoHouseholdError", async () => {
    await expect(setup.households.requireMembership("max")).rejects.toBeInstanceOf(NoHouseholdError);
    const created = await setup.households.createHousehold("max", { name: "Mustermann" });
    if (!created.ok) throw new Error("setup failed");
    expect(await setup.households.requireMembership("max")).toEqual({ householdId: created.household.id });
  });
});

describe("isolation between households", () => {
  it("never returns another household", async () => {
    const a = await setup.households.createHousehold("max", { name: "A" });
    const b = await setup.households.createHousehold("dora", { name: "B" });
    if (!a.ok || !b.ok) throw new Error("setup failed");

    expect(await setup.households.getHousehold("max")).toMatchObject({ id: a.household.id, memberCount: 1 });
    expect(await setup.households.getHousehold("dora")).toMatchObject({ id: b.household.id, memberCount: 1 });
    expect(await setup.households.getHousehold("stranger")).toBeNull();
    expect(await setup.households.getMembership("stranger")).toBeNull();
  });
});

function eqUser(userId: string) {
  return eq(householdMember.userId, userId);
}
