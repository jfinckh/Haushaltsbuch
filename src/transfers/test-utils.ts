import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createFieldCrypto } from "@/shared/field-crypto";
import { normalizeIban } from "@/shared/iban";
import { withSession, type Caller } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createTransactions } from "@/transactions/server";
import { createTransfers } from "./create-transfers";
import type { Member } from "./signals";

/** A booking as an import would create it. */
export type TestBooking = {
  date: string;
  amountCents: number;
  counterparty?: string | null;
  counterpartyIban?: string | null;
  reference?: string | null;
  kind?: "expense" | "income" | "transfer" | "saving";
};

/** What a rule decided for a booking. */
export type RuleResult = {
  kind: "expense" | "income" | "transfer" | "saving";
  category?: string | null;
  target?: "external" | null;
};

export const MEMBERS: Member[] = [
  { userId: "max", name: "Max Mustermann" },
  { userId: "erika", name: "Erika Mustermann" },
];

/**
 * A fresh in-memory Postgres with the real migrations for transfers tests. Households and accounts
 * are written straight into their tables (tests only, so transfers stays independent of their code;
 * the table names and the account IBAN index context are part of their database contract).
 */
export async function createTestDatabase({ today = "2026-10-21" }: { today?: string } = {}) {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  const crypto = createFieldCrypto({
    keys: `1:${randomBytes(32).toString("base64")}`,
    indexKey: randomBytes(32).toString("base64"),
  });
  const transactions = createTransactions({ db, crypto });
  const transfers = createTransfers({ db, crypto, transactions, today: () => today });

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
  async function addAccount(
    id: string,
    owner: string,
    {
      householdId = null,
      bank = "ing",
      role = "everyday",
      iban = null,
    }: { householdId?: string | null; bank?: string; role?: string; iban?: string | null } = {},
  ) {
    const type = bank === "trade_republic" ? "clearing" : role === "savings" ? "savings" : "checking";
    const normalized = iban && normalizeIban(iban);
    await db.execute(sql`
      INSERT INTO account (id, owner_user_id, household_id, visibility, name, bank, type, role, iban_encrypted, iban_index)
      VALUES (${id}, ${owner}, ${householdId}, ${householdId ? "shared" : "private"}, ${id}, ${bank}, ${type}, ${role},
        ${normalized && crypto.encrypt(normalized, "account.iban")}, ${normalized && crypto.blindIndex(normalized, "account.iban")})`);
  }

  /** Creates bookings in `userId`'s session, like an import, and runs the matching for them. */
  /**
   * Like importBookings, but first sets type and category as rules would (index → result), and hands
   * the rule transfers to the matching, as the app does after an import.
   */
  async function importWithRules(
    userId: string,
    accountId: string,
    bookings: TestBooking[],
    ruleFor: (index: number) => RuleResult | null,
  ) {
    const caller = await as(userId);
    const ids = await insert(caller, accountId, bookings);
    const results = ids.flatMap((id, index) => {
      const result = ruleFor(index);
      return result ? [{ id, ...result }] : [];
    });
    await withSession(db, caller, (tx) =>
      transactions.classifyBookings(tx, results.map(({ id, kind, category = null }) => ({ id, kind, category }))),
    );
    const ruleTransfers = results
      .filter((r) => r.kind === "transfer" || r.kind === "saving")
      .map((r) => ({ id: r.id, target: r.target ?? null }));
    const result = await transfers.matchAfterImport(caller, { bookingIds: ids, members: MEMBERS, ruleTransfers });
    return { ids, result };
  }

  async function insert(caller: Caller, accountId: string, bookings: TestBooking[]) {
    return withSession(db, caller, (tx, sessionUserId) =>
      transactions.insertBookings(
        tx,
        sessionUserId,
        bookings.map((b) => ({
          accountId,
          bookingDate: b.date,
          amountCents: b.amountCents,
          kind: b.kind ?? (b.amountCents < 0 ? "expense" : "income"),
          category: null,
          counterparty: b.counterparty ?? null,
          counterpartyIban: b.counterpartyIban ? normalizeIban(b.counterpartyIban) : null,
          reference: b.reference ?? null,
        })),
      ),
    );
  }

  async function importBookings(userId: string, accountId: string, bookings: TestBooking[], members = MEMBERS) {
    const caller = await as(userId);
    const ids = await insert(caller, accountId, bookings);
    const result = await transfers.matchAfterImport(caller, { bookingIds: ids, members });
    return { ids, result };
  }

  /** A booking's stored type, straight from the table (past row-level security). */
  async function kindOf(id: string) {
    const result = (await db.execute(sql`SELECT kind, category FROM "transaction" WHERE id = ${id}`)) as unknown as {
      rows: { kind: string; category: string | null }[];
    };
    return result.rows[0]?.kind;
  }

  /** A booking's stored classification source, straight from the table. */
  async function classifiedByOf(id: string) {
    const result = (await db.execute(sql`SELECT classified_by FROM "transaction" WHERE id = ${id}`)) as unknown as {
      rows: { classified_by: string }[];
    };
    return result.rows[0]?.classified_by;
  }

  /** All pairs, straight from the table. */
  async function pairs() {
    const result = (await db.execute(
      sql`SELECT outgoing_transaction_id AS out, incoming_transaction_id AS in, status, manual FROM transfer_pair ORDER BY created_at`,
    )) as unknown as { rows: { out: string; in: string; status: string; manual: boolean }[] };
    return result.rows;
  }

  async function deleteBooking(id: string) {
    await db.execute(sql`DELETE FROM "transaction" WHERE id = ${id}`);
  }

  return { db, crypto, transactions, transfers, as, householdOf, addAccount, importBookings, importWithRules, kindOf, classifiedByOf, pairs, deleteBooking };
}

export const ING_IBAN = "DE94123456781111111111";

/** The transfer cases of test-data/ing_testdaten.csv, in its order (newest first). */
export const ING_ROWS: TestBooking[] = [
  { date: "2026-10-15", amountCents: -20000, counterparty: "Trade Republic", reference: "Trade Republic 1a2b3c4d-0000-4000-8000-000000000003" },
  { date: "2026-10-14", amountCents: -100000, counterparty: "Trade Republic", reference: "Trade Republic 1a2b3c4d-0000-4000-8000-000000000002" },
  { date: "2026-10-05", amountCents: 15000, counterparty: "Erika Mustermann", reference: "Anteil Urlaub" },
  { date: "2026-10-02", amountCents: -149, counterparty: "ING", reference: "GIROCARD 900000000001 MONATLICHES ENTGELT GIROCARD (DEBITKARTE)" },
  { date: "2026-10-01", amountCents: -120000, counterparty: "Max Mustermann", reference: "Miete und co" },
  { date: "2026-09-30", amountCents: -90000, counterparty: "Trade Republic", reference: "Trade Republic 1a2b3c4d-0000-4000-8000-000000000001" },
  { date: "2026-09-15", amountCents: 50000, counterparty: "Max Mustermann" },
  { date: "2026-09-01", amountCents: -120000, counterparty: "Max Mustermann", reference: "Miete und co" },
];

/** The transfer cases of test-data/traderepublic_testdaten.csv. */
export const TR_ROWS: TestBooking[] = [
  { date: "2026-10-02", amountCents: 90000, counterparty: "Max Mustermann", counterpartyIban: ING_IBAN, reference: `Direct Debit Top up with ${ING_IBAN}` },
  { date: "2026-10-03", amountCents: -5000, counterparty: "Kind Mustermann", counterpartyIban: "DE97123456783333333333", reference: "Outgoing transfer for Kind Mustermann (DE97123456783333333333)" },
  { date: "2026-10-15", amountCents: 100000, counterparty: "Max Mustermann", counterpartyIban: ING_IBAN, reference: `Direct Debit Top up with ${ING_IBAN}` },
  { date: "2026-09-02", amountCents: -25000, kind: "saving", reference: "Savings plan execution IE00BJ0KDQ92" },
];
