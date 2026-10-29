import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";

// The app's database login (a member of app_runtime, drizzle/0026_runtime_roles.sql) must not read
// domain data on its own: only through app_user (row-level security per session) or, for
// households' bootstrap writes, households_admin. Runs on PGlite with the real migrations, logged
// in as such a role with SET SESSION AUTHORIZATION (like the app's own connection).

let pg: PGlite;
let domainTables: string[];

async function count(table: string): Promise<number> {
  const { rows } = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
  return rows[0].n;
}

beforeAll(async () => {
  pg = new PGlite();
  await migrate(drizzle({ client: pg }), { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  await pg.exec(`
    CREATE ROLE runtime_test_app LOGIN;
    GRANT app_runtime TO runtime_test_app;
    INSERT INTO auth_user (id, name, email) VALUES ('u1', 'u1', 'u1@example.test'), ('u2', 'u2', 'u2@example.test');
    INSERT INTO auth_session (id, token, user_id, expires_at) VALUES ('s1', 'token-u1', 'u1', now() + interval '1 hour');
    INSERT INTO household (id, name, created_by_user_id) VALUES ('h1', 'One', 'u1'), ('h2', 'Two', 'u2');
    INSERT INTO household_member (household_id, user_id) VALUES ('h1', 'u1'), ('h2', 'u2');
  `);
  const { rows } = await pg.query<{ name: string }>(
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'auth\\_%' ORDER BY 1",
  );
  domainTables = rows.map((row) => row.name);
  await pg.exec("SET SESSION AUTHORIZATION runtime_test_app");
});

describe("the app's database login", () => {
  it("finds domain tables to check", () => {
    expect(domainTables).toEqual(expect.arrayContaining(["account", "transaction", "household", "household_member", "budget"]));
  });

  it("has no rights on any domain table", async () => {
    for (const table of domainTables) {
      await expect(count(table), table).rejects.toThrow(/permission denied/);
    }
  });

  it("reads and writes Better Auth's tables", async () => {
    expect(await count("auth_user")).toBe(2);
    await pg.exec("UPDATE auth_user SET name = 'renamed' WHERE id = 'u2'");
  });

  it("sees only the session user's rows as app_user", async () => {
    const seen = await pg.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE app_user");
      await tx.query("SELECT set_config('app.session_token', $1, true)", ["token-u1"]);
      const { rows } = await tx.query<{ id: string }>("SELECT id FROM household ORDER BY id");
      return rows.map((row) => row.id);
    });
    expect(seen).toEqual(["h1"]);
  });

  it("sees every household as households_admin, but no other domain table", async () => {
    const result = await pg.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE households_admin");
      const { rows } = await tx.query<{ id: string }>("SELECT id FROM household ORDER BY id");
      const { rows: has } = await tx.query<{ has: boolean }>("SELECT accounts_household_has_accounts('h1') AS has");
      return { households: rows.map((row) => row.id), hasAccounts: has[0].has };
    });
    expect(result).toEqual({ households: ["h1", "h2"], hasAccounts: false });
    await expect(
      pg.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE households_admin");
        await tx.query("SELECT count(*) FROM account");
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
