import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import type { Caller } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createHouseholds, type HouseholdsOptions } from "./create-households";

/**
 * The households part on a fresh in-memory Postgres with the real migrations. `as(userId)` signs
 * the user in (a real session in auth's table) and returns them as a Caller.
 *
 * `runtimeRole`: the whole connection then runs as a login like the app's own (a member of
 * app_runtime, drizzle/0026_runtime_roles.sql), so every query has the production rights. `db`
 * can then not read the household tables directly: check through the households part.
 */
export async function createTestHouseholds({
  runtimeRole = false,
  ...options
}: Omit<HouseholdsOptions, "db"> & { runtimeRole?: boolean } = {}) {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  if (runtimeRole) {
    await db.execute(sql`CREATE ROLE households_test_app LOGIN`);
    await db.execute(sql`GRANT app_runtime TO households_test_app`);
    await db.execute(sql`SET SESSION AUTHORIZATION households_test_app`);
  }
  const callers = new Map<string, Promise<Caller>>();
  function as(userId: string): Promise<Caller> {
    if (!callers.has(userId)) callers.set(userId, createTestSession(db, userId));
    return callers.get(userId)!;
  }
  return { households: createHouseholds({ db, ...options }), db, as };
}

/** An invite from `inviterId`, accepted at second `second` after the epoch: higher is newer. */
export function invite(inviterId: string, second = 1) {
  return { inviterId, invitedAt: new Date(second * 1000) };
}
