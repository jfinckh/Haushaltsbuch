import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withSession } from "@/shared/rls";
import { transaction } from "./schema";
import { createTestDatabase } from "./test-utils";

type Setup = Awaited<ReturnType<typeof createTestDatabase>>;

let setup: Setup;

const row = (id: string, accountId: string, createdByUserId: string) => ({
  id,
  accountId,
  bookingDate: "2026-10-01",
  amountCents: -350,
  kind: "expense" as const,
  createdByUserId,
});

beforeEach(async () => {
  setup = await createTestDatabase();
  await setup.householdOf("home", "max", "erika");
  await setup.householdOf("other", "dora");
  await setup.addAccount("max-private", "max");
  await setup.addAccount("home-shared", "max", "home");
  await setup.addAccount("erika-private", "erika");
  await setup.addAccount("dora-shared", "dora", "other");
  // Owner connection: rows straight into the table, past row-level security.
  await setup.db.insert(transaction).values([
    row("t-max", "max-private", "max"),
    row("t-home", "home-shared", "erika"),
    row("t-erika", "erika-private", "erika"),
    row("t-dora", "dora-shared", "dora"),
  ]);
});

async function asUser<T>(userId: string, fn: Parameters<typeof withSession<T>>[2]) {
  return withSession(setup.db, await setup.as(userId), fn);
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
const all = (userId: string) => asUser(userId, (tx) => tx.select().from(transaction));

describe("row-level security on transactions", () => {
  it("returns only bookings of visible accounts, even without a filter", async () => {
    expect(ids(await all("max"))).toEqual(["t-home", "t-max"]);
    expect(ids(await all("erika"))).toEqual(["t-erika", "t-home"]);
    expect(ids(await all("dora"))).toEqual(["t-dora"]);
    expect(ids(await all("lone"))).toEqual([]);
  });

  it("returns nothing without a session", async () => {
    const rows = await setup.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      return tx.select().from(transaction);
    });
    expect(rows).toEqual([]);
  });

  it("does not let anyone book on an account they cannot see", async () => {
    await expect(asUser("erika", (tx) => tx.insert(transaction).values(row("x", "max-private", "erika")))).rejects.toThrow();
    await expect(asUser("erika", (tx) => tx.insert(transaction).values(row("x", "dora-shared", "erika")))).rejects.toThrow();
  });

  it("records the session's user as creator, never someone else", async () => {
    await expect(asUser("erika", (tx) => tx.insert(transaction).values(row("x", "home-shared", "max")))).rejects.toThrow();
    await asUser("erika", (tx) => tx.insert(transaction).values(row("x", "home-shared", "erika")));
    expect(ids(await all("max"))).toContain("x");
  });

  it("does not let anyone change or delete bookings of invisible accounts", async () => {
    const updated = await asUser("erika", (tx) =>
      tx.update(transaction).set({ amountCents: -1 }).where(eq(transaction.id, "t-max")).returning(),
    );
    const deleted = await asUser("erika", (tx) => tx.delete(transaction).where(eq(transaction.id, "t-max")).returning());
    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);
    const [unchanged] = await setup.db.select().from(transaction).where(eq(transaction.id, "t-max"));
    expect(unchanged.amountCents).toBe(-350);
  });

  it("does not let anyone move a booking into an invisible account", async () => {
    await expect(
      asUser("erika", (tx) =>
        tx.update(transaction).set({ accountId: "max-private" }).where(eq(transaction.id, "t-home")),
      ),
    ).rejects.toThrow();
  });

  it("lets every member change bookings of a shared account", async () => {
    await asUser("max", (tx) => tx.update(transaction).set({ amountCents: -400 }).where(eq(transaction.id, "t-home")));
    const [changed] = await setup.db.select().from(transaction).where(eq(transaction.id, "t-home"));
    expect(changed.amountCents).toBe(-400);
  });

  it("hides a shared account's bookings once it becomes private", async () => {
    await setup.makePrivate("home-shared");
    expect(ids(await all("erika"))).toEqual(["t-erika"]);
    expect(ids(await all("max"))).toEqual(["t-home", "t-max"]);
  });

  it("deletes an account's bookings with the account", async () => {
    await setup.deleteAccount("home-shared");
    expect(ids(await setup.db.select().from(transaction))).toEqual(["t-dora", "t-erika", "t-max"]);
  });
});

describe("who created a booking", () => {
  it("cannot be changed, while the booking itself can", async () => {
    await expect(
      asUser("max", (tx) => tx.update(transaction).set({ createdByUserId: "max" }).where(eq(transaction.id, "t-home"))),
    ).rejects.toThrow();
    const changed = await asUser("max", (tx) =>
      tx.update(transaction).set({ amountCents: -400 }).where(eq(transaction.id, "t-home")).returning({ id: transaction.id }),
    );
    expect(changed).toEqual([{ id: "t-home" }]);
    const [stored] = await setup.db.select().from(transaction).where(eq(transaction.id, "t-home"));
    expect(stored).toMatchObject({ createdByUserId: "erika", amountCents: -400 });
  });
});
