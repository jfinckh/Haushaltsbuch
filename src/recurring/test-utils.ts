import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createFieldCrypto } from "@/shared/field-crypto";
import type { Caller } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createTransactions } from "@/transactions/server";
import { recurringTemplate } from "./schema";

export type TestTemplate = Partial<typeof recurringTemplate.$inferInsert> & { id: string; accountId: string };

/**
 * A fresh in-memory Postgres with the real migrations for recurring tests. Households and accounts
 * are written straight into their tables (tests only, so recurring stays independent of their code;
 * the table names are part of their database contract).
 */
export async function createTestDatabase() {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  const crypto = createFieldCrypto({
    keys: `1:${randomBytes(32).toString("base64")}`,
    indexKey: randomBytes(32).toString("base64"),
  });
  const transactions = createTransactions({ db, crypto });

  const callers = new Map<string, Promise<Caller>>();
  /** Signs the user in (once) and returns their session. */
  function as(userId: string): Promise<Caller> {
    if (!callers.has(userId)) callers.set(userId, createTestSession(db, userId));
    return callers.get(userId)!;
  }

  async function householdOf(householdId: string, ...userIds: string[]) {
    for (const userId of userIds) await as(userId);
    await db.execute(sql`
      INSERT INTO household (id, name, created_by_user_id) VALUES (${householdId}, ${householdId}, ${userIds[0]})
      ON CONFLICT (id) DO NOTHING`);
    for (const userId of userIds) {
      await db.execute(sql`INSERT INTO household_member (household_id, user_id) VALUES (${householdId}, ${userId})`);
    }
  }

  /** A private account of `owner`, or a shared one of `householdId`. */
  async function addAccount(id: string, owner: string, householdId: string | null = null) {
    await as(owner);
    await db.execute(sql`
      INSERT INTO account (id, owner_user_id, household_id, visibility, name, bank, type, role)
      VALUES (${id}, ${owner}, ${householdId}, ${householdId ? "shared" : "private"}, ${id}, 'ing', 'checking', 'everyday')`);
  }

  async function setArchived(accountId: string, archived: boolean) {
    await db.execute(sql`UPDATE account SET archived_at = ${archived ? sql`now()` : sql`NULL`} WHERE id = ${accountId}`);
  }

  /** A template straight into the table (past row-level security); monthly on the 28th by default. */
  async function addTemplate(template: TestTemplate) {
    const createdBy = template.createdByUserId ?? "max";
    await as(createdBy);
    await db.insert(recurringTemplate).values({
      amountCents: -120000,
      kind: "expense",
      classifiedBy: "manual",
      intervalMonths: 1,
      dayOfMonth: 28,
      nextDueDate: "2026-11-28",
      createdByUserId: createdBy,
      ...template,
    });
  }

  /** Rows of a query on the owner connection (past row-level security). */
  async function query<T>(statement: SQL): Promise<T[]> {
    return ((await db.execute(statement)) as unknown as { rows: T[] }).rows;
  }

  return { db, crypto, transactions, as, householdOf, addAccount, setArchived, addTemplate, query };
}
