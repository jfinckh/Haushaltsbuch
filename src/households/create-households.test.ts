import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { InvalidSessionError } from "@/shared/rls";
import { NoHouseholdError } from "./create-households";
import { household, householdMember } from "./schema";
import { createTestHouseholds, invite } from "./test-utils";

type Setup = Awaited<ReturnType<typeof createTestHouseholds>>;

let setup: Setup;

beforeEach(async () => {
  setup = await createTestHouseholds();
});

describe("creating a household", () => {
  it("makes the user its first member, in EUR", async () => {
    const result = await setup.households.createHousehold(await setup.as("max"), { name: "  Mustermann " });
    expect(result).toEqual({
      ok: true,
      household: { id: expect.any(String), name: "Mustermann", currency: "EUR", memberCount: 1 },
    });
    expect(await setup.households.getMembership(await setup.as("max"))).toEqual({ householdId: result.ok && result.household.id });
  });

  it("allows only one household per user", async () => {
    await setup.households.createHousehold(await setup.as("max"), { name: "First" });
    expect(await setup.households.createHousehold(await setup.as("max"), { name: "Second" })).toEqual({
      ok: false,
      reason: "already-member",
    });
  });

  it("rejects invalid input", async () => {
    expect(await setup.households.createHousehold(await setup.as("max"), { name: "" })).toEqual({ ok: false, reason: "invalid-input" });
    expect(await setup.households.getMembership(await setup.as("max"))).toBeNull();
  });
});

describe("joining through an invite", () => {
  it("adds the invited user to the inviter's household", async () => {
    const created = await setup.households.createHousehold(await setup.as("max"), { name: "Mustermann" });
    if (!created.ok) throw new Error("setup failed");

    const result = await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"));
    expect(result).toEqual({ membership: { householdId: created.household.id }, keptOwnHousehold: false, keptReason: null });
    expect((await setup.households.getHousehold(await setup.as("erika")))?.memberCount).toBe(2);

    const [row] = await setup.db.select().from(householdMember).where(eqUser("erika"));
    expect(row.invitedByUserId).toBe("max");
  });

  it("is idempotent", async () => {
    await setup.households.createHousehold(await setup.as("max"), { name: "Mustermann" });
    const first = await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"));
    const second = await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"));
    expect(second).toEqual(first);
    expect((await setup.households.getHousehold(await setup.as("max")))?.memberCount).toBe(2);
  });

  it("does nothing without an inviter or when the inviter has no household", async () => {
    const none = { membership: null, keptOwnHousehold: false, keptReason: null };
    expect(await setup.households.joinInvitersHousehold(await setup.as("erika"), null)).toEqual(none);
    expect(await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"))).toEqual(none);
    expect(await setup.households.getMembership(await setup.as("erika"))).toBeNull();
  });

  it("moves a user out of their own household when nobody else is in it, and deletes it", async () => {
    const maxs = await setup.households.createHousehold(await setup.as("max"), { name: "Mustermann" });
    const own = await setup.households.createHousehold(await setup.as("erika"), { name: "Erikas" });
    if (!maxs.ok || !own.ok) throw new Error("setup failed");

    const result = await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"));
    expect(result).toEqual({ membership: { householdId: maxs.household.id }, keptOwnHousehold: false, keptReason: null });
    expect(await setup.db.select().from(household).where(eq(household.id, own.household.id))).toEqual([]);
    expect((await setup.households.getHousehold(await setup.as("max")))?.memberCount).toBe(2);
  });

  it("keeps the own household when it has other members, until the user leaves it", async () => {
    const maxs = await setup.households.createHousehold(await setup.as("max"), { name: "Mustermann" });
    const own = await setup.households.createHousehold(await setup.as("erika"), { name: "Erikas" });
    if (!maxs.ok || !own.ok) throw new Error("setup failed");
    await setup.households.joinInvitersHousehold(await setup.as("lena"), invite("erika"));

    expect(await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"))).toEqual({
      membership: { householdId: own.household.id },
      keptOwnHousehold: true,
      keptReason: "other-members",
    });
    expect((await setup.households.getHousehold(await setup.as("max")))?.memberCount).toBe(1);

    await setup.households.leaveHousehold(await setup.as("erika"));
    expect(await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"))).toEqual({
      membership: { householdId: maxs.household.id },
      keptOwnHousehold: false,
      keptReason: null,
    });
    expect(await setup.households.listMembers(await setup.as("lena"))).toEqual([{ userId: "lena", joinedAt: expect.any(Date) }]);
  });

  it("keeps the own household while it holds data, until the user leaves it", async () => {
    const holding = new Set<string>();
    setup = await createTestHouseholds({ householdHoldsData: async (_tx, id) => holding.has(id) });
    const maxs = await setup.households.createHousehold(await setup.as("max"), { name: "Mustermann" });
    const own = await setup.households.createHousehold(await setup.as("erika"), { name: "Erikas" });
    if (!maxs.ok || !own.ok) throw new Error("setup failed");
    holding.add(own.household.id);

    expect(await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"))).toEqual({
      membership: { householdId: own.household.id },
      keptOwnHousehold: true,
      keptReason: "holds-data",
    });
    expect((await setup.households.getHousehold(await setup.as("max")))?.memberCount).toBe(1);

    await setup.households.leaveHousehold(await setup.as("erika"));
    expect(await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"))).toEqual({
      membership: { householdId: maxs.household.id },
      keptOwnHousehold: false,
      keptReason: null,
    });
  });

  it("does not ask about data when the own household has other members", async () => {
    const asked: string[] = [];
    setup = await createTestHouseholds({ householdHoldsData: async (_tx, id) => (asked.push(id), false) });
    await setup.households.createHousehold(await setup.as("max"), { name: "Mustermann" });
    await setup.households.createHousehold(await setup.as("erika"), { name: "Erikas" });
    await setup.households.joinInvitersHousehold(await setup.as("lena"), invite("erika"));
    const result = await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"));
    expect(result.keptReason).toBe("other-members");
    expect(asked).toEqual([]);
  });

  it("does not put a user back after they left", async () => {
    await setup.households.createHousehold(await setup.as("max"), { name: "Mustermann" });
    await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"));
    await setup.households.leaveHousehold(await setup.as("erika"));

    expect(await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"))).toEqual({
      membership: null,
      keptOwnHousehold: false,
      keptReason: null,
    });
    expect((await setup.households.getHousehold(await setup.as("max")))?.memberCount).toBe(1);
  });

  it("joins with a new invite after leaving, from the same or another inviter", async () => {
    const maxs = await setup.households.createHousehold(await setup.as("max"), { name: "Mustermann" });
    const doras = await setup.households.createHousehold(await setup.as("dora"), { name: "Doras" });
    if (!maxs.ok || !doras.ok) throw new Error("setup failed");
    await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max", 1));
    await setup.households.leaveHousehold(await setup.as("erika"));

    expect(await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("dora", 2))).toEqual({
      membership: { householdId: doras.household.id },
      keptOwnHousehold: false,
      keptReason: null,
    });
    await setup.households.leaveHousehold(await setup.as("erika"));
    expect(await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max", 3))).toEqual({
      membership: { householdId: maxs.household.id },
      keptOwnHousehold: false,
      keptReason: null,
    });
  });

  it("keeps a shared household on a new invite until the user leaves it", async () => {
    const maxs = await setup.households.createHousehold(await setup.as("max"), { name: "Mustermann" });
    const doras = await setup.households.createHousehold(await setup.as("dora"), { name: "Doras" });
    if (!maxs.ok || !doras.ok) throw new Error("setup failed");
    await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max", 1));

    expect(await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("dora", 2))).toEqual({
      membership: { householdId: maxs.household.id },
      keptOwnHousehold: true,
      keptReason: "other-members",
    });
    await setup.households.leaveHousehold(await setup.as("erika"));
    expect(await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("dora", 2))).toEqual({
      membership: { householdId: doras.household.id },
      keptOwnHousehold: false,
      keptReason: null,
    });
    expect((await setup.households.getHousehold(await setup.as("max")))?.memberCount).toBe(1);
  });

  it("ignores an invite that is not newer than the last one acted on", async () => {
    await setup.households.createHousehold(await setup.as("max"), { name: "Mustermann" });
    await setup.households.createHousehold(await setup.as("dora"), { name: "Doras" });
    await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max", 2));
    await setup.households.leaveHousehold(await setup.as("erika"));

    expect(await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("dora", 1))).toEqual({
      membership: null,
      keptOwnHousehold: false,
      keptReason: null,
    });
  });
});

describe("listing members", () => {
  it("returns the own household's members, oldest first", async () => {
    await setup.households.createHousehold(await setup.as("max"), { name: "A" });
    await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"));
    await setup.households.createHousehold(await setup.as("dora"), { name: "B" });

    const members = await setup.households.listMembers(await setup.as("erika"));
    expect(members.map((m) => m.userId)).toEqual(["max", "erika"]);
    expect((await setup.households.listMembers(await setup.as("dora"))).map((m) => m.userId)).toEqual(["dora"]);
    expect(await setup.households.listMembers(await setup.as("stranger"))).toEqual([]);
  });
});

describe("renaming", () => {
  it("lets any member rename the own household", async () => {
    await setup.households.createHousehold(await setup.as("max"), { name: "A" });
    await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"));

    const result = await setup.households.renameHousehold(await setup.as("erika"), { name: " Musterhaus " });
    expect(result).toMatchObject({ ok: true, household: { name: "Musterhaus", memberCount: 2 } });
    expect((await setup.households.getHousehold(await setup.as("max")))?.name).toBe("Musterhaus");
  });

  it("rejects invalid names and users without a household", async () => {
    await setup.households.createHousehold(await setup.as("max"), { name: "A" });
    expect(await setup.households.renameHousehold(await setup.as("max"), { name: "" })).toEqual({ ok: false, reason: "invalid-input" });
    expect(await setup.households.renameHousehold(await setup.as("stranger"), { name: "X" })).toEqual({
      ok: false,
      reason: "no-household",
    });
  });

  it("never renames another household", async () => {
    await setup.households.createHousehold(await setup.as("max"), { name: "A" });
    await setup.households.createHousehold(await setup.as("dora"), { name: "B" });
    await setup.households.renameHousehold(await setup.as("dora"), { name: "Dora's" });
    expect((await setup.households.getHousehold(await setup.as("max")))?.name).toBe("A");
  });
});

describe("leaving", () => {
  it("keeps the household for the remaining members", async () => {
    await setup.households.createHousehold(await setup.as("max"), { name: "A" });
    await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"));

    expect(await setup.households.leaveHousehold(await setup.as("erika"))).toEqual({ left: true, householdDeleted: false });
    expect(await setup.households.getMembership(await setup.as("erika"))).toBeNull();
    expect((await setup.households.getHousehold(await setup.as("max")))?.memberCount).toBe(1);
  });

  it("deletes the household when the last member leaves", async () => {
    const a = await setup.households.createHousehold(await setup.as("max"), { name: "A" });
    if (!a.ok) throw new Error("setup failed");
    expect(await setup.households.leaveHousehold(await setup.as("max"))).toEqual({ left: true, householdDeleted: true });
    expect(await setup.db.select().from(household)).toEqual([]);
    expect(await setup.db.select().from(householdMember)).toEqual([]);
  });

  it("deletes the household when its last two members leave at the same time", async () => {
    await setup.households.createHousehold(await setup.as("max"), { name: "A" });
    await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"));
    await Promise.all([setup.households.leaveHousehold(await setup.as("max")), setup.households.leaveHousehold(await setup.as("erika"))]);
    expect(await setup.db.select().from(household)).toEqual([]);
  });

  it("does nothing without a household and never touches another one", async () => {
    await setup.households.createHousehold(await setup.as("dora"), { name: "B" });
    expect(await setup.households.leaveHousehold(await setup.as("stranger"))).toEqual({ left: false, householdDeleted: false });
    expect((await setup.households.getHousehold(await setup.as("dora")))?.memberCount).toBe(1);
  });
});

describe("requireMembership", () => {
  it("returns the membership or throws NoHouseholdError", async () => {
    await expect(setup.households.requireMembership(await setup.as("max"))).rejects.toBeInstanceOf(NoHouseholdError);
    const created = await setup.households.createHousehold(await setup.as("max"), { name: "Mustermann" });
    if (!created.ok) throw new Error("setup failed");
    expect(await setup.households.requireMembership(await setup.as("max"))).toEqual({ householdId: created.household.id });
  });
});

describe("sessions", () => {
  it("refuses callers without a valid session", async () => {
    const forged = { sessionToken: "forged" };
    await expect(setup.households.getHousehold(forged)).rejects.toBeInstanceOf(InvalidSessionError);
    await expect(setup.households.createHousehold(forged, { name: "X" })).rejects.toBeInstanceOf(InvalidSessionError);
    await expect(setup.households.joinInvitersHousehold(forged, invite("max"))).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
    expect(await setup.db.select().from(household)).toEqual([]);
  });
});

describe("isolation between households", () => {
  it("never returns another household", async () => {
    const a = await setup.households.createHousehold(await setup.as("max"), { name: "A" });
    const b = await setup.households.createHousehold(await setup.as("dora"), { name: "B" });
    if (!a.ok || !b.ok) throw new Error("setup failed");

    expect(await setup.households.getHousehold(await setup.as("max"))).toMatchObject({ id: a.household.id, memberCount: 1 });
    expect(await setup.households.getHousehold(await setup.as("dora"))).toMatchObject({ id: b.household.id, memberCount: 1 });
    expect(await setup.households.getHousehold(await setup.as("stranger"))).toBeNull();
    expect(await setup.households.getMembership(await setup.as("stranger"))).toBeNull();
  });
});

function eqUser(userId: string) {
  return eq(householdMember.userId, userId);
}
