import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { InvalidSessionError, withSession, type RlsDatabase } from "./rls";
import { createTestSession, endTestSessions } from "./test-sessions";

let db: RlsDatabase;

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite() });
  await migrate(pglite, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  db = pglite;
});

const currentUser = (rows: unknown) => (rows as { rows: { id: string | null }[] }).rows[0].id;

describe("withSession", () => {
  it("passes the user the database found for the session", async () => {
    const max = await createTestSession(db, "max");
    const erika = await createTestSession(db, "erika");
    expect(await withSession(db, max, async (_tx, userId) => userId)).toBe("max");
    expect(await withSession(db, erika, async (_tx, userId) => userId)).toBe("erika");
  });

  it("runs as the restricted role and the database sees the same user", async () => {
    const max = await createTestSession(db, "max");
    const seen = await withSession(db, max, async (tx) => ({
      role: (await tx.execute(sql`SELECT current_user AS id`)) as unknown,
      user: (await tx.execute(sql`SELECT auth_current_user_id() AS id`)) as unknown,
    }));
    expect(currentUser(seen.role)).toBe("app_user");
    expect(currentUser(seen.user)).toBe("max");
  });

  it.each([
    ["an unknown token", { sessionToken: "not-a-session" }],
    ["an empty token", { sessionToken: "" }],
  ])("rejects %s", async (_label, caller) => {
    let ran = false;
    await expect(withSession(db, caller, async () => (ran = true))).rejects.toThrow(InvalidSessionError);
    expect(ran).toBe(false);
  });

  it("rejects an expired session", async () => {
    const expired = await createTestSession(db, "max", { expiresAt: new Date(Date.now() - 1000) });
    await expect(withSession(db, expired, async () => null)).rejects.toThrow(InvalidSessionError);
  });

  it("stops working once the session ends", async () => {
    const max = await createTestSession(db, "max");
    await endTestSessions(db, "max");
    await expect(withSession(db, max, async () => null)).rejects.toThrow(InvalidSessionError);
  });

  it("keeps the restricted role away from auth's tables", async () => {
    const max = await createTestSession(db, "max");
    await expect(withSession(db, max, (tx) => tx.execute(sql`SELECT * FROM auth_session`))).rejects.toThrow();
  });

  it("forgets the session after the transaction", async () => {
    const max = await createTestSession(db, "max");
    await withSession(db, max, async () => null);
    const after = await db.execute(sql`SELECT nullif(current_setting('app.session_token', true), '') AS id`);
    expect(currentUser(after)).toBeNull();
  });
});
