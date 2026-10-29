// Applies the SQL migrations in ./drizzle (`npm run db:migrate` locally, the "migrate" container on
// the server, see Dockerfile). drizzle-kit is a dev dependency, so this uses drizzle-orm's own
// migrator. It reads the same migration journal and records applied migrations in the same table.
//
// Two connections, two users:
//   MIGRATION_DATABASE_URL  the database owner. The migrations create roles, grant them and define
//                           SECURITY DEFINER functions.
//   DATABASE_URL            the app's connection. After the migrations this script creates (or
//                           updates) that login role with the password from the URL and makes it a
//                           member of app_runtime, which has no rights on any domain table
//                           (drizzle/0026_runtime_roles.sql).
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
if (!migrationUrl) fail("MIGRATION_DATABASE_URL is not set (the database owner's connection)");
if (!appUrl) fail("DATABASE_URL is not set (the app's connection)");

let owner;
let app;
try {
  owner = new URL(migrationUrl);
  app = new URL(appUrl);
} catch {
  fail("MIGRATION_DATABASE_URL or DATABASE_URL is not a valid URL");
}
const appUser = decodeURIComponent(app.username);
const appPassword = decodeURIComponent(app.password);
if (!appUser || !appPassword) fail("DATABASE_URL needs a user and a password");
if (decodeURIComponent(owner.username) === appUser) {
  fail("DATABASE_URL must use another user than MIGRATION_DATABASE_URL: the app must not connect as the owner");
}

const pool = new pg.Pool({ connectionString: migrationUrl });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied");

  const client = await pool.connect();
  try {
    const role = client.escapeIdentifier(appUser);
    const password = client.escapeLiteral(appPassword);
    const { rowCount } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appUser]);
    // Since PostgreSQL 16 a non-superuser owner may not name SUPERUSER or CREATEDB in ALTER ROLE,
    // not even to switch them off. So ALTER only sets what the owner may change, and the check
    // below makes sure the login has no extra rights.
    await client.query(
      rowCount
        ? `ALTER ROLE ${role} LOGIN NOCREATEROLE PASSWORD ${password}`
        : `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${password}`,
    );
    const { rows } = await client.query(
      `SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls AS privileged
         FROM pg_roles WHERE rolname = $1`,
      [appUser],
    );
    if (rows[0]?.privileged) {
      throw new Error(
        `App login role ${appUser} has SUPERUSER, CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS; remove it as a superuser`,
      );
    }
    await client.query(`GRANT app_runtime TO ${role}`);
    console.log(`App login role ${appUser} is ready`);
  } finally {
    client.release();
  }
} catch (error) {
  // Only messages: never print query parameters, row data or the password. drizzle's own message
  // names the failed statement, the cause says why (e.g. a missing permission). The role
  // statements are not quoted in pg's messages. pg's detail names roles and attributes only.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const detail = [error, error instanceof Error ? error.cause : undefined]
    .map((e) => (e && typeof e === "object" && typeof e.detail === "string" ? e.detail : ""))
    .find(Boolean);
  console.error(
    "Migration failed:",
    error instanceof Error ? error.message : "unknown error",
    cause,
    detail ?? "",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
