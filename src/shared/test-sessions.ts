import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Caller, RlsDatabase } from "./rls";

// Tests only. Creates signed-in users directly in auth's tables (auth_user, auth_session) of a
// test database, so parts can be tested with real sessions without depending on auth's code.

/** Creates the user `userId` if needed and a session for them; returns that session as a Caller. */
export async function createTestSession(
  db: RlsDatabase,
  userId: string,
  { expiresAt = new Date(Date.now() + 60 * 60 * 1000) }: { expiresAt?: Date } = {},
): Promise<Caller> {
  await db.execute(sql`
    INSERT INTO auth_user (id, name, email) VALUES (${userId}, ${userId}, ${`${userId}@example.test`})
    ON CONFLICT (id) DO NOTHING`);
  const sessionToken = randomUUID();
  await db.execute(sql`
    INSERT INTO auth_session (id, token, user_id, expires_at)
    VALUES (${randomUUID()}, ${sessionToken}, ${userId}, ${expiresAt.toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
  return { sessionToken };
}

/** Ends all sessions of `userId`, like signing out everywhere. */
export async function endTestSessions(db: RlsDatabase, userId: string) {
  await db.execute(sql`DELETE FROM auth_session WHERE user_id = ${userId}`);
}
