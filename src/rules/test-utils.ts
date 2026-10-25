import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createFieldCrypto } from "@/shared/field-crypto";
import { withSession, type Caller } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createTransactions } from "@/transactions/server";
import { createRules } from "./create-rules";

/** A booking as an import would create it. */
export type TestBooking = {
  date: string;
  amountCents: number;
  counterparty?: string | null;
  reference?: string | null;
  kind?: "expense" | "income" | "transfer" | "saving";
  category?: string | null;
};

/**
 * A fresh in-memory Postgres with the real migrations for rules tests. Households and accounts are
 * written straight into their tables (tests only, so rules stays independent of their code; the
 * table names are part of their database contract).
 */
export async function createTestDatabase() {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  const crypto = createFieldCrypto({
    keys: `1:${randomBytes(32).toString("base64")}`,
    indexKey: randomBytes(32).toString("base64"),
  });
  const transactions = createTransactions({ db, crypto });
  const rules = createRules({ db, crypto, transactions });

  const callers = new Map<string, Promise<Caller>>();
  /** Signs the user in (once) and returns their session. */
  function as(userId: string): Promise<Caller> {
    if (!callers.has(userId)) callers.set(userId, createTestSession(db, userId));
    return callers.get(userId)!;
  }

  async function householdOf(householdId: string, ...userIds: string[]) {
    await db.execute(sql`
      INSERT INTO household (id, name, created_by_user_id) VALUES (${householdId}, ${householdId}, ${userIds[0]})
      ON CONFLICT (id) DO NOTHING`);
    for (const userId of userIds) {
      await db.execute(sql`INSERT INTO household_member (household_id, user_id) VALUES (${householdId}, ${userId})`);
    }
  }

  /** A private account of `owner`, or a shared one of `householdId`. */
  async function addAccount(id: string, owner: string, householdId: string | null = null) {
    await db.execute(sql`
      INSERT INTO account (id, owner_user_id, household_id, visibility, name, bank, type, role)
      VALUES (${id}, ${owner}, ${householdId}, ${householdId ? "shared" : "private"}, ${id}, 'ing', 'checking', 'everyday')`);
  }

  async function makePrivate(accountId: string) {
    await db.execute(sql`UPDATE account SET visibility = 'private', household_id = NULL WHERE id = ${accountId}`);
  }

  /** Creates bookings in `userId`'s session, like an import (classified auto). */
  async function importBookings(userId: string, accountId: string, bookings: TestBooking[]) {
    const caller = await as(userId);
    return withSession(db, caller, (tx, sessionUserId) =>
      transactions.insertBookings(
        tx,
        sessionUserId,
        bookings.map((b) => ({
          accountId,
          bookingDate: b.date,
          amountCents: b.amountCents,
          kind: b.kind ?? (b.amountCents < 0 ? "expense" : "income"),
          category: b.category ?? null,
          counterparty: b.counterparty ?? null,
          counterpartyIban: null,
          reference: b.reference ?? null,
        })),
      ),
    );
  }

  /** A booking's stored kind, category and source, straight from the table (past row-level security). */
  async function stored(id: string) {
    const result = (await db.execute(
      sql`SELECT kind, category, classified_by FROM "transaction" WHERE id = ${id}`,
    )) as unknown as { rows: { kind: string; category: string | null; classified_by: string }[] };
    const row = result.rows[0];
    return row && { kind: row.kind, category: row.category, classifiedBy: row.classified_by };
  }

  /** All rule rows, straight from the table. */
  async function ruleRows() {
    const result = (await db.execute(sql`SELECT * FROM booking_rule`)) as unknown as { rows: Record<string, unknown>[] };
    return result.rows;
  }

  /** All hidden suggestions, straight from the table. */
  async function dismissalRows() {
    const result = (await db.execute(sql`SELECT * FROM rule_suggestion_dismissal`)) as unknown as { rows: Record<string, unknown>[] };
    return result.rows;
  }

  return { db, crypto, transactions, rules, as, householdOf, addAccount, makePrivate, importBookings, stored, ruleRows, dismissalRows };
}

/** The cases of test-data/ing_testdaten.csv the rules tests use. */
export const ING_ROWS: TestBooking[] = [
  { date: "2026-10-07", amountCents: -5472, counterparty: "VISA REWE MARKT GMBH", reference: "NR XXXX 1234 STUTTGART DE KAUFUMSATZ 05.10 54,72 101015 ARN00000000000000000000006 Apple Pay" },
  { date: "2026-10-05", amountCents: 15000, counterparty: "Erika Mustermann", reference: "Anteil Urlaub" },
  { date: "2026-10-01", amountCents: -120000, counterparty: "Max Mustermann", reference: "Miete und co" },
  { date: "2026-09-15", amountCents: 50000, counterparty: "Max Mustermann" },
  { date: "2026-09-04", amountCents: -1099, counterparty: "PayPal Europe S.a.r.l. et Cie S.C.A", reference: "1000000000001/PP.1234.PP/. Spotify AB, Ihr Einkauf bei Spotify AB" },
  { date: "2026-09-03", amountCents: -4567, counterparty: "VISA REWE MARKT GMBH", reference: "NR XXXX 1234 STUTTGART DE KAUFUMSATZ 01.09 45,67 101010 ARN00000000000000000000001 Apple Pay" },
];
