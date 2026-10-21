import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withSession } from "@/shared/rls";
import { account } from "./schema";
import { createTestAccounts } from "./test-utils";

type Setup = Awaited<ReturnType<typeof createTestAccounts>>;

let setup: Setup;

const row = (id: string, ownerUserId: string, householdId: string | null) => ({
  id,
  ownerUserId,
  householdId,
  visibility: householdId ? ("shared" as const) : ("private" as const),
  name: id,
  bank: "ing" as const,
  type: "checking" as const,
  role: "everyday" as const,
});

beforeEach(async () => {
  setup = await createTestAccounts();
  await setup.householdOf("home", "max", "erika");
  await setup.householdOf("other", "dora");
  // Owner connection: rows straight into the table, past row-level security.
  await setup.db.insert(account).values([
    row("max-private", "max", null),
    row("max-shared", "max", "home"),
    row("erika-private", "erika", null),
    row("dora-shared", "dora", "other"),
  ]);
});

async function asUser<T>(userId: string, fn: Parameters<typeof withSession<T>>[2]) {
  return withSession(setup.db, await setup.as(userId), fn);
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe("row-level security on accounts", () => {
  it("returns only visible rows, even without a filter", async () => {
    expect(ids(await asUser("max", (tx) => tx.select().from(account)))).toEqual(["max-private", "max-shared"]);
    expect(ids(await asUser("erika", (tx) => tx.select().from(account)))).toEqual(["erika-private", "max-shared"]);
    expect(ids(await asUser("dora", (tx) => tx.select().from(account)))).toEqual(["dora-shared"]);
    expect(ids(await asUser("lone", (tx) => tx.select().from(account)))).toEqual([]);
  });

  it("returns nothing without a session, or with a user id instead of a session", async () => {
    const rows = await setup.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      await tx.execute(sql`SELECT set_config('app.user_id', 'max', true)`);
      return tx.select().from(account);
    });
    expect(rows).toEqual([]);
  });

  it("does not let anyone create accounts for others or other households", async () => {
    await expect(asUser("erika", (tx) => tx.insert(account).values(row("fake", "max", null)))).rejects.toThrow();
    await expect(asUser("erika", (tx) => tx.insert(account).values(row("fake", "erika", "other")))).rejects.toThrow();
    await expect(asUser("erika", (tx) => tx.insert(account).values(row("ok", "erika", "home")))).resolves.toBeDefined();
  });

  it("does not let a member change or delete another member's private account", async () => {
    const updated = await asUser("erika", (tx) =>
      tx.update(account).set({ name: "hacked" }).where(eq(account.id, "max-private")).returning(),
    );
    const deleted = await asUser("erika", (tx) => tx.delete(account).where(eq(account.id, "max-private")).returning());
    expect([updated, deleted]).toEqual([[], []]);
    const [kept] = await setup.db.select().from(account).where(eq(account.id, "max-private"));
    expect(kept.name).toBe("max-private");
  });

  it("does not let a non-owner make a shared account private", async () => {
    await expect(
      asUser("erika", (tx) =>
        tx.update(account).set({ visibility: "private", householdId: null }).where(eq(account.id, "max-shared")),
      ),
    ).rejects.toThrow();
  });

  it("does not let anyone move a shared account into another household", async () => {
    await expect(
      asUser("max", (tx) => tx.update(account).set({ householdId: "other" }).where(eq(account.id, "max-shared"))),
    ).rejects.toThrow();
  });

  it("lets members change and delete shared accounts of their household", async () => {
    await asUser("erika", (tx) => tx.update(account).set({ name: "Haushalt" }).where(eq(account.id, "max-shared")));
    const deleted = await asUser("erika", (tx) => tx.delete(account).where(eq(account.id, "max-shared")).returning());
    expect(ids(deleted)).toEqual(["max-shared"]);
  });

  it("follows the session: after leaving, the household's shared accounts disappear", async () => {
    await setup.leaveHousehold("erika");
    expect(ids(await asUser("erika", (tx) => tx.select().from(account)))).toEqual(["erika-private"]);
  });
});
