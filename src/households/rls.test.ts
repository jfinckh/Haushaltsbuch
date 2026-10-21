import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { household, householdInviteUse, householdMember } from "./schema";
import { withSession } from "@/shared/rls";
import { createTestHouseholds, invite } from "./test-utils";

type Setup = Awaited<ReturnType<typeof createTestHouseholds>>;

let setup: Setup;
let householdA: string;

beforeEach(async () => {
  setup = await createTestHouseholds();
  const a = await setup.households.createHousehold(await setup.as("max"), { name: "A" });
  await setup.households.joinInvitersHousehold(await setup.as("erika"), invite("max"));
  await setup.households.createHousehold(await setup.as("dora"), { name: "B" });
  if (!a.ok) throw new Error("setup failed");
  householdA = a.household.id;
});

describe("row-level security", () => {
  it("returns only rows of the current user's household, even without a filter", async () => {
    const rows = await withSession(setup.db, await setup.as("max"), async (tx) => ({
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

  it("ignores a user id set by the server code instead of a session", async () => {
    const rows = await setup.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      await tx.execute(sql`SELECT set_config('app.user_id', 'max', true)`);
      return tx.select().from(household);
    });
    expect(rows).toEqual([]);
  });

  it("blocks writing into another household", async () => {
    await expect(
      withSession(setup.db, await setup.as("dora"), (tx) => tx.insert(householdMember).values({ householdId: householdA, userId: "intruder" })),
    ).rejects.toThrow();
    await expect(
      withSession(setup.db, await setup.as("dora"), (tx) => tx.update(household).set({ name: "hacked" }).where(sql`true`).returning()),
    ).resolves.toHaveLength(1); // only dora's own household is visible, so only it is updated
    const [a] = await setup.db.select().from(household).where(sql`${household.id} = ${householdA}`);
    expect(a.name).toBe("A");
  });

  it("keeps the restricted role away from used invites", async () => {
    await expect(withSession(setup.db, await setup.as("erika"), (tx) => tx.select().from(householdInviteUse))).rejects.toThrow();
  });
});

describe("households_current_user_member_ids (households' database contract)", () => {
  const memberIds = async (userId: string) =>
    withSession(setup.db, await setup.as(userId), async (tx) => {
      const result = (await tx.execute(sql`SELECT households_current_user_member_ids() AS id`)) as unknown as {
        rows: { id: string }[];
      };
      return result.rows.map((row) => row.id).sort();
    });

  it("lists the members of the session user's household only", async () => {
    expect(await memberIds("max")).toEqual(["erika", "max"]);
    expect(await memberIds("dora")).toEqual(["dora"]);
    expect(await memberIds("lone")).toEqual([]);
  });
});
