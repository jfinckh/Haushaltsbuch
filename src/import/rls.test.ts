import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withSession } from "@/shared/rls";
import { importBatch, importRow } from "./schema";
import { createTestDatabase } from "./test-utils";

type Setup = Awaited<ReturnType<typeof createTestDatabase>>;

let setup: Setup;

const batch = (id: string, accountId: string, createdByUserId: string) => ({
  id,
  accountId,
  bank: "ing" as const,
  fileNameEncrypted: "x",
  fileEncrypted: "x",
  rowCount: 1,
  newCount: 1,
  duplicateCount: 0,
  skippedCount: 0,
  createdByUserId,
});

async function booking(id: string, accountId: string) {
  await setup.db.execute(sql`
    INSERT INTO "transaction" (id, account_id, booking_date, amount_cents, kind, created_by_user_id)
    VALUES (${id}, ${accountId}, '2026-10-01', -100, 'expense', 'max')`);
}

const row = (id: string, importId: string, accountId: string, transactionId: string) => ({
  id,
  importId,
  accountId,
  transactionId,
  fingerprint: `fp-${id}`,
  line: 2,
  rawEncrypted: "x",
});

beforeEach(async () => {
  setup = await createTestDatabase();
  await setup.householdOf("home", "max", "erika");
  await setup.householdOf("other", "dora");
  await setup.addAccount("max-private", "max");
  await setup.addAccount("home-shared", "max", "home");
  await setup.addAccount("dora-shared", "dora", "other");
  await booking("t-max", "max-private");
  await booking("t-home", "home-shared");
  await booking("t-dora", "dora-shared");
  // Owner connection: rows straight into the tables, past row-level security.
  await setup.db.insert(importBatch).values([
    batch("i-max", "max-private", "max"),
    batch("i-home", "home-shared", "erika"),
    batch("i-dora", "dora-shared", "dora"),
  ]);
  await setup.db.insert(importRow).values([
    row("r-max", "i-max", "max-private", "t-max"),
    row("r-home", "i-home", "home-shared", "t-home"),
    row("r-dora", "i-dora", "dora-shared", "t-dora"),
  ]);
});

async function asUser<T>(userId: string, fn: Parameters<typeof withSession<T>>[2]) {
  return withSession(setup.db, await setup.as(userId), fn);
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe("row-level security on imports", () => {
  it("shows imports and rows only of visible accounts", async () => {
    expect(ids(await asUser("max", (tx) => tx.select().from(importBatch)))).toEqual(["i-home", "i-max"]);
    expect(ids(await asUser("erika", (tx) => tx.select().from(importBatch)))).toEqual(["i-home"]);
    expect(ids(await asUser("erika", (tx) => tx.select().from(importRow)))).toEqual(["r-home"]);
    expect(ids(await asUser("dora", (tx) => tx.select().from(importRow)))).toEqual(["r-dora"]);
    expect(ids(await asUser("lone", (tx) => tx.select().from(importBatch)))).toEqual([]);
  });

  it("does not let a member import into another member's private account", async () => {
    await expect(asUser("erika", (tx) => tx.insert(importBatch).values(batch("i-new", "max-private", "erika")))).rejects.toThrow();
    await expect(
      asUser("erika", (tx) => tx.insert(importRow).values(row("r-new", "i-max", "max-private", "t-max"))),
    ).rejects.toThrow();
  });

  it("records the session's user as the creator", async () => {
    await expect(asUser("erika", (tx) => tx.insert(importBatch).values(batch("i-new", "home-shared", "max")))).rejects.toThrow();
  });

  it("does not let rows point to an import of another account", async () => {
    await booking("t-home-2", "home-shared");
    await expect(
      asUser("max", (tx) => tx.insert(importRow).values(row("r-new", "i-max", "home-shared", "t-home-2"))),
    ).rejects.toThrow();
  });

  it("does not let a member delete another member's private import", async () => {
    const deleted = await asUser("erika", (tx) => tx.delete(importBatch).returning());
    expect(ids(deleted)).toEqual(["i-home"]);
    expect(ids(await asUser("max", (tx) => tx.select().from(importBatch)))).toEqual(["i-max"]);
  });

  it("frees the fingerprint when the booking is deleted", async () => {
    await setup.db.execute(sql`DELETE FROM "transaction" WHERE id = 't-max'`);
    expect(ids(await asUser("max", (tx) => tx.select().from(importRow)))).toEqual(["r-home"]);
  });

  it("hides imports when a shared account becomes private", async () => {
    await setup.makePrivate("home-shared");
    expect(ids(await asUser("erika", (tx) => tx.select().from(importBatch)))).toEqual([]);
  });

  it("deletes imports with their account", async () => {
    await setup.deleteAccount("max-private");
    const left = (await setup.db.execute(sql`SELECT id FROM import ORDER BY id`)) as unknown as { rows: { id: string }[] };
    expect(ids(left.rows)).toEqual(["i-dora", "i-home"]);
  });
});
