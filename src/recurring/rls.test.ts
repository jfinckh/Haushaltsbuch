import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withSession } from "@/shared/rls";
import { recurringTemplate } from "./schema";
import { createTestDatabase } from "./test-utils";

// The database itself shows each member only the templates of accounts they may see: a template on a
// private account exists only for its owner. The runner role reads nothing.

let setup: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
  setup = await createTestDatabase();
  await setup.householdOf("home", "max", "erika");
  await setup.addAccount("max-private", "max");
  await setup.addAccount("shared", "max", "home");
  await setup.addTemplate({ id: "on-private", accountId: "max-private" });
  await setup.addTemplate({ id: "on-shared", accountId: "shared" });
});

async function visibleIds(userId: string): Promise<string[]> {
  return withSession(setup.db, await setup.as(userId), async (tx) => {
    const found = await tx.select({ id: recurringTemplate.id }).from(recurringTemplate).orderBy(asc(recurringTemplate.id));
    return found.map((row) => row.id);
  });
}

describe("recurring templates and row-level security", () => {
  it("erika sees the template on the shared account but not max's private one", async () => {
    expect(await visibleIds("erika")).toEqual(["on-shared"]);
  });

  it("max sees both", async () => {
    expect(await visibleIds("max")).toEqual(["on-private", "on-shared"]);
  });

  it("erika cannot insert a template on max's private account", async () => {
    const insert = withSession(setup.db, await setup.as("erika"), (tx, userId) =>
      tx.insert(recurringTemplate).values({
        id: "sneaky",
        accountId: "max-private",
        amountCents: -100,
        kind: "expense",
        classifiedBy: "manual",
        intervalMonths: 1,
        dayOfMonth: 1,
        nextDueDate: "2026-12-01",
        createdByUserId: userId,
      }),
    );
    await expect(insert).rejects.toThrow();
  });

  it("erika cannot update or delete max's private template", async () => {
    const changed = await withSession(setup.db, await setup.as("erika"), async (tx) => {
      const updated = await tx
        .update(recurringTemplate)
        .set({ paused: true })
        .where(eq(recurringTemplate.id, "on-private"))
        .returning({ id: recurringTemplate.id });
      const deleted = await tx.delete(recurringTemplate).where(eq(recurringTemplate.id, "on-private")).returning({ id: recurringTemplate.id });
      return updated.length + deleted.length;
    });
    expect(changed).toBe(0);
  });

  it("erika sees the occurrences of shared templates only", async () => {
    await setup.db.execute(sql`
      INSERT INTO recurring_occurrence (template_id, due_date) VALUES ('on-private', '2026-10-28'), ('on-shared', '2026-10-28')`);
    const ids = await withSession(setup.db, await setup.as("erika"), async (tx) => {
      const result = (await tx.execute(sql`SELECT template_id FROM recurring_occurrence`)) as unknown as { rows: { template_id: string }[] };
      return result.rows.map((row) => row.template_id);
    });
    expect(ids).toEqual(["on-shared"]);
  });

  it("recurring_runner cannot read recurring_template, transaction or account", async () => {
    for (const table of ["recurring_template", "recurring_occurrence", "transaction", "account"]) {
      const read = setup.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE recurring_runner`);
        await tx.execute(sql.raw(`SELECT count(*) FROM "${table}"`));
      });
      // Drizzle wraps the driver's error; the reason is in its cause.
      const error = await read.then(() => null, (e: { cause?: { message?: string } }) => e);
      expect(error?.cause?.message, table).toMatch(/permission denied/);
    }
  });
});
