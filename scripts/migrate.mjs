// Applies the SQL migrations in ./drizzle on the server (the "migrate" container, see Dockerfile).
// drizzle-kit is a dev dependency, so production uses drizzle-orm's own migrator. It reads the same
// migration journal and records applied migrations in the same table as `npm run db:migrate`.
// Must connect as the database owner: the migrations create the role app_user, grant it and define
// SECURITY DEFINER functions.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied");
} catch (error) {
  // Only the message: never print query parameters or row data.
  // Migrations carry no booking data, but print only messages anyway: drizzle's own message
  // names the failed statement, the cause says why (e.g. a missing permission).
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  console.error("Migration failed:", error instanceof Error ? error.message : "unknown error", cause);
  process.exitCode = 1;
} finally {
  await pool.end();
}
