import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { household, householdInviteUse, householdMember } from "./schema";
import { asUser } from "./scoped";
import { createTestHouseholds, invite } from "./test-utils";

type Setup = Awaited<ReturnType<typeof createTestHouseholds>>;

let setup: Setup;
let householdA: string;

beforeEach(async () => {
  setup = await createTestHouseholds();
  const a = await setup.households.createHousehold("max", { name: "A" });
  await setup.households.joinInvitersHousehold("erika", invite("max"));
  await setup.households.createHousehold("dora", { name: "B" });
  if (!a.ok) throw new Error("setup failed");
  householdA = a.household.id;
});

describe("row-level security", () => {
  it("returns only rows of the current user's household, even without a filter", async () => {
    const rows = await asUser(setup.db, "max", async (tx) => ({
      households: await tx.select().from(household),
      members: await tx.select().from(householdMember),
    }));
    expect(rows.households.map((h) => h.id)).toEqual([householdA]);
    expect(rows.members.map((m) => m.userId).sort()).toEqual(["erika", "max"]);
  });

  it("returns nothing without a current user", async () => {
    const rows = await setup.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      return {
        households: await tx.select().from(household),
        members: await tx.select().from(householdMember),
      };
    });
    expect(rows).toEqual({ households: [], members: [] });
  });

  it("blocks writing into another household", async () => {
    await expect(
      asUser(setup.db, "dora", (tx) => tx.insert(householdMember).values({ householdId: householdA, userId: "intruder" })),
    ).rejects.toThrow();
    await expect(
      asUser(setup.db, "dora", (tx) => tx.update(household).set({ name: "hacked" }).where(sql`true`).returning()),
    ).resolves.toHaveLength(1); // only dora's own household is visible, so only it is updated
    const [a] = await setup.db.select().from(household).where(sql`${household.id} = ${householdA}`);
    expect(a.name).toBe("A");
  });

  it("keeps the restricted role away from used invites", async () => {
    await expect(asUser(setup.db, "erika", (tx) => tx.select().from(householdInviteUse))).rejects.toThrow();
  });
});
