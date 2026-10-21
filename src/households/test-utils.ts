import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Caller } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createHouseholds, type HouseholdsOptions } from "./create-households";

/**
 * The households part on a fresh in-memory Postgres with the real migrations. `as(userId)` signs
 * the user in (a real session in auth's table) and returns them as a Caller.
 */
export async function createTestHouseholds(options: Omit<HouseholdsOptions, "db"> = {}) {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
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
