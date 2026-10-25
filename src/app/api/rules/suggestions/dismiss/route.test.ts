import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { dismissSuggestionRoute } from "@/app/_lib/rules-route";
import { createRules, type Rules } from "@/rules/server";
import { createFieldCrypto } from "@/shared/field-crypto";
import { withSession, type Caller, type RlsDatabase } from "@/shared/rls";
import { createTestSession } from "@/shared/test-sessions";
import { createTransactions, type Transactions } from "@/transactions/server";

// The hide route: only signed-in members, only valid input, and a hidden suggestion stays hidden
// only for the member who hid it (privacy: suggestions come only from bookings they may see).

let db: RlsDatabase;
let transactions: Transactions;
let rules: Rules;
let callers: Map<string, Promise<Caller>>;

const sessionOf = (userId: string | null) => async () => {
  if (userId === null) return null;
  if (!callers.has(userId)) callers.set(userId, createTestSession(db, userId));
  return callers.get(userId)!;
};

const post = (userId: string | null, body: unknown) =>
  dismissSuggestionRoute({ rules, getCaller: sessionOf(userId) }).POST(
    new Request("http://localhost/api/rules/suggestions/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const TODAY = "2026-10-25";
const patterns = async (userId: string) =>
  (await rules.listSuggestions((await sessionOf(userId)())!, { today: TODAY })).map((s) => s.pattern);

beforeEach(async () => {
  const pglite = drizzle({ client: new PGlite() });
  await migrate(pglite, { migrationsFolder: new URL("../../../../../../drizzle", import.meta.url).pathname });
  db = pglite;
  const crypto = createFieldCrypto({ keys: `1:${randomBytes(32).toString("base64")}`, indexKey: randomBytes(32).toString("base64") });
  transactions = createTransactions({ db, crypto });
  rules = createRules({ db, crypto, transactions });
  callers = new Map();
  await Promise.all(["max", "erika"].map((id) => sessionOf(id)()));
  await db.execute(sql`INSERT INTO household (id, name, created_by_user_id) VALUES ('home', 'home', 'max')`);
  await db.execute(sql`INSERT INTO household_member (household_id, user_id) VALUES ('home', 'max'), ('home', 'erika')`);
  await db.execute(sql`
    INSERT INTO account (id, owner_user_id, household_id, visibility, name, bank, type, role)
    VALUES ('shared', 'max', 'home', 'shared', 'Gemeinsam', 'ing', 'checking', 'everyday'),
           ('erika-ing', 'erika', NULL, 'private', 'Erika', 'ing', 'checking', 'everyday')`);
  const edeka = (accountId: string, date: string) => ({
    accountId, bookingDate: date, amountCents: -3506, kind: "expense" as const, category: null,
    counterparty: "VISA EDEKA MUSTERMARKT", counterpartyIban: null, reference: null,
  });
  await withSession(db, (await sessionOf("max")())!, (tx, userId) =>
    transactions.insertBookings(tx, userId, ["2026-10-01", "2026-10-08", "2026-10-15"].map((d) => edeka("shared", d))),
  );
  await withSession(db, (await sessionOf("erika")())!, (tx, userId) =>
    transactions.insertBookings(tx, userId, ["2026-10-02", "2026-10-09", "2026-10-16"].map((d) => edeka("erika-ing", d))),
  );
});

describe("POST /api/rules/suggestions/dismiss", () => {
  it("needs a signed-in member", async () => {
    expect((await post(null, { field: "counterparty", pattern: "EDEKA MUSTERMARKT" })).status).toBe(401);
  });

  it("rejects invalid input", async () => {
    expect((await post("max", { field: "category", pattern: "EDEKA" })).status).toBe(400);
    expect((await post("max", { field: "counterparty", pattern: "" })).status).toBe(400);
  });

  it("hides the suggestion only for the caller", async () => {
    expect(await patterns("max")).toEqual(["EDEKA MUSTERMARKT"]);
    expect((await post("max", { field: "counterparty", pattern: "EDEKA MUSTERMARKT" })).status).toBe(204);
    expect(await patterns("max")).toEqual([]);
    expect(await patterns("erika")).toEqual(["EDEKA MUSTERMARKT"]);
  });

  it("never shows a member suggestions from another member's private account", async () => {
    // Erika sees six bookings (shared + her own), Max only the three shared ones.
    const max = await rules.listSuggestions((await sessionOf("max")())!, { today: TODAY });
    const erika = await rules.listSuggestions((await sessionOf("erika")())!, { today: TODAY });
    expect(max.map((s) => s.count)).toEqual([3]);
    expect(erika.map((s) => s.count)).toEqual([6]);
    expect(max.some((s) => s.accountId === "erika-ing")).toBe(false);
  });
});
