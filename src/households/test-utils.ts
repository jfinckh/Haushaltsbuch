import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createHouseholds } from "./create-households";

/** The households part on a fresh in-memory Postgres with the real migrations. */
export async function createTestHouseholds() {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  return { households: createHouseholds({ db }), db };
}
