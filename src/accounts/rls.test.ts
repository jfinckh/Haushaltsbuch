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

describe("accounts_visible_account_ids (accounts' database contract)", () => {
  async function visibleIds(userId: string) {
    const result = (await asUser(userId, (tx) =>
      tx.execute(sql`SELECT accounts_visible_account_ids() AS id`),
    )) as unknown as { rows: { id: string }[] };
    return ids(result.rows);
  }

  it("lists exactly the accounts the session's user may see", async () => {
    expect(await visibleIds("max")).toEqual(["max-private", "max-shared"]);
    expect(await visibleIds("erika")).toEqual(["erika-private", "max-shared"]);
    expect(await visibleIds("dora")).toEqual(["dora-shared"]);
    expect(await visibleIds("lone")).toEqual([]);
  });

  it("includes archived accounts", async () => {
    await setup.db.update(account).set({ archivedAt: new Date() }).where(eq(account.id, "max-private"));
    expect(await visibleIds("max")).toEqual(["max-private", "max-shared"]);
  });
});

describe("accounts_household_accounts (accounts' contract for database functions)", () => {
  /** Calls it like a SECURITY DEFINER function of another part would: as the owner, with the session set. */
  async function householdAccounts(userId: string) {
    const caller = await setup.as(userId);
    return setup.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.session_token', ${caller.sessionToken}, true)`);
      const result = (await tx.execute(sql`SELECT id, visible FROM accounts_household_accounts() ORDER BY id`)) as unknown as {
        rows: { id: string; visible: boolean }[];
      };
      return result.rows;
    });
  }

  it("lists the household's shared accounts and its members' private accounts, with visibility", async () => {
    expect(await householdAccounts("max")).toEqual([
      { id: "erika-private", visible: false },
      { id: "max-private", visible: true },
      { id: "max-shared", visible: true },
    ]);
    expect(await householdAccounts("dora")).toEqual([{ id: "dora-shared", visible: true }]);
    expect(await householdAccounts("lone")).toEqual([]);
  });

  it("says visible for exactly the accounts accounts_visible_account_ids gives", async () => {
    for (const userId of ["max", "erika", "dora"]) {
      const visible = (await householdAccounts(userId)).filter((a) => a.visible).map((a) => a.id);
      const viaContract = await asUser(userId, async (tx) => {
        const result = (await tx.execute(sql`SELECT accounts_visible_account_ids() AS id`)) as unknown as { rows: { id: string }[] };
        return result.rows.map((r) => r.id).sort();
      });
      expect(visible).toEqual(viaContract);
    }
  });

  it("cannot be called by app_user", async () => {
    await expect(asUser("max", (tx) => tx.execute(sql`SELECT * FROM accounts_household_accounts()`))).rejects.toThrow();
  });
});

describe("accounts_visible_account_scopes (accounts' database contract)", () => {
  async function scopes(userId: string) {
    const result = (await asUser(userId, (tx) =>
      tx.execute(sql`SELECT account_id, household_id FROM accounts_visible_account_scopes() ORDER BY account_id`),
    )) as unknown as { rows: { account_id: string; household_id: string | null }[] };
    return result.rows;
  }

  it("lists the visible accounts with their household, none for private accounts", async () => {
    expect(await scopes("max")).toEqual([
      { account_id: "max-private", household_id: null },
      { account_id: "max-shared", household_id: "home" },
    ]);
    expect(await scopes("erika")).toEqual([
      { account_id: "erika-private", household_id: null },
      { account_id: "max-shared", household_id: "home" },
    ]);
    expect(await scopes("lone")).toEqual([]);
  });
});
