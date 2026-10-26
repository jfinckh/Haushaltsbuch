import { and, asc, eq, or, sql, type SQL } from "drizzle-orm";
import type { FieldCrypto } from "@/shared/field-crypto";
import { withSession, type Caller, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import { formatIban } from "@/shared/iban";
import type { Accounts, AccountView, CreateAccountResult, UpdateAccountResult } from "./contract";
import { account } from "./schema";
import { accountValuesSchema, createAccountSchema, createTradeRepublicSchema, updateAccountSchema, type AccountValues } from "./validation";

export type AccountsOptions = {
  db: RlsDatabase;
  /** Encrypts IBANs; keys come from the environment. */
  crypto: FieldCrypto;
};

const IBAN_CONTEXT = "account.iban";

type AccountRow = typeof account.$inferSelect;

/**
 * Accounts visible to the session's user: their private accounts and the shared accounts of their
 * household. Row-level security applies the same rule; this filter keeps the code correct on its own.
 */
function visibleTo(userId: string): SQL {
  return or(
    and(eq(account.visibility, "private"), eq(account.ownerUserId, userId)),
    and(
      eq(account.visibility, "shared"),
      sql`${account.householdId} IN (SELECT households_current_user_household_ids())`,
    ),
  )!;
}

/** The session user's household, from households' database contract. */
async function currentHouseholdId(tx: RlsTransaction): Promise<string | null> {
  const result = (await tx.execute(sql`SELECT households_current_user_household_ids() AS id LIMIT 1`)) as unknown as {
    rows: { id: string }[];
  };
  return result.rows[0]?.id ?? null;
}

/** The accounts part. Every call is about the caller's own view; their user id comes from the database. */
export function createAccounts({ db, crypto: fieldCrypto }: AccountsOptions): Accounts {
  function toView(row: AccountRow, userId: string): AccountView {
    return {
      id: row.id,
      name: row.name,
      bank: row.bank,
      type: row.type,
      role: row.role,
      visibility: row.visibility,
      openingBalanceCents: row.openingBalanceCents,
      iban: row.ibanEncrypted ? formatIban(fieldCrypto.decrypt(row.ibanEncrypted, IBAN_CONTEXT)) : null,
      archived: row.archivedAt !== null,
      ownedByMe: row.ownerUserId === userId,
    };
  }

  function ibanColumns(iban: string | null) {
    return iban
      ? { ibanEncrypted: fieldCrypto.encrypt(iban, IBAN_CONTEXT), ibanIndex: fieldCrypto.blindIndex(iban, IBAN_CONTEXT) }
      : { ibanEncrypted: null, ibanIndex: null };
  }

  async function findVisible(tx: RlsTransaction, userId: string, id: string, lock = false) {
    const query = tx
      .select()
      .from(account)
      .where(and(eq(account.id, id), visibleTo(userId)));
    const [row] = lock ? await query.for("update") : await query;
    return row ?? null;
  }

  async function insertAccounts(
    tx: RlsTransaction,
    userId: string,
    accounts: AccountValues[],
  ): Promise<CreateAccountResult> {
    const shared = accounts.some((a) => a.visibility === "shared");
    const householdId = shared ? await currentHouseholdId(tx) : null;
    if (shared && !householdId) return { ok: false, reason: "no-household" };
    const rows = await tx
      .insert(account)
      .values(
        accounts.map(({ iban, ...values }) => ({
          ...values,
          ...ibanColumns(iban),
          id: crypto.randomUUID(),
          ownerUserId: userId,
          householdId: values.visibility === "shared" ? householdId : null,
        })),
      )
      .returning();
    return { ok: true, accounts: rows.map((row) => toView(row, userId)) };
  }

  return {
    async listAccounts(caller: Caller): Promise<AccountView[]> {
      return withSession(db, caller, async (tx, userId) => {
        const rows = await tx
          .select()
          .from(account)
          .where(visibleTo(userId))
          .orderBy(asc(account.name), asc(account.createdAt));
        return rows.map((row) => toView(row, userId));
      });
    },

    async getAccount(caller: Caller, id: string): Promise<AccountView | null> {
      return withSession(db, caller, async (tx, userId) => {
        const row = await findVisible(tx, userId, id);
        return row && toView(row, userId);
      });
    },

    async createAccount(caller: Caller, input: unknown): Promise<CreateAccountResult> {
      const isTradeRepublic = (input as { setup?: unknown } | null)?.setup === "trade-republic";
      let accounts: AccountValues[];
      if (isTradeRepublic) {
        const parsed = createTradeRepublicSchema.safeParse(input);
        if (!parsed.success) return { ok: false, reason: "invalid-input" };
        const { visibility, iban, clearingOpeningBalance, depotOpeningBalance } = parsed.data;
        accounts = [
          {
            name: "Trade Republic",
            bank: "trade_republic",
            type: "clearing",
            role: "everyday",
            visibility,
            openingBalanceCents: clearingOpeningBalance,
            iban: iban ?? null,
          },
          {
            name: "Trade Republic Depot",
            bank: "trade_republic",
            type: "depot",
            role: "savings",
            visibility,
            openingBalanceCents: depotOpeningBalance,
            iban: null,
          },
        ];
      } else {
        const parsed = createAccountSchema.safeParse(input);
        if (!parsed.success) return { ok: false, reason: "invalid-input" };
        accounts = [parsed.data];
      }
      return withSession(db, caller, (tx, userId) => insertAccounts(tx, userId, accounts));
    },

    async updateAccount(caller: Caller, id: string, input: unknown): Promise<UpdateAccountResult> {
      const parsed = updateAccountSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: "invalid-input" };
      const { openingBalance, iban, archived, ...changes } = parsed.data;

      return withSession(db, caller, async (tx, userId): Promise<UpdateAccountResult> => {
        const row = await findVisible(tx, userId, id, true);
        if (!row) return { ok: false, reason: "not-found" };
        const merged = accountValuesSchema.safeParse({
          name: changes.name ?? row.name,
          bank: changes.bank ?? row.bank,
          type: changes.type ?? row.type,
          role: changes.role ?? row.role,
          visibility: changes.visibility ?? row.visibility,
          openingBalanceCents: openingBalance ?? row.openingBalanceCents,
          iban: iban !== undefined ? iban : row.ibanEncrypted && fieldCrypto.decrypt(row.ibanEncrypted, IBAN_CONTEXT),
        });
        if (!merged.success) return { ok: false, reason: "invalid-input" };
        const next = merged.data;

        let householdId = row.householdId;
        if (next.visibility !== row.visibility) {
          if (row.ownerUserId !== userId) return { ok: false, reason: "not-owner" };
          householdId = next.visibility === "shared" ? await currentHouseholdId(tx) : null;
          if (next.visibility === "shared" && !householdId) return { ok: false, reason: "no-household" };
        }

        const [updated] = await tx
          .update(account)
          .set({
            name: next.name,
            bank: next.bank,
            type: next.type,
            role: next.role,
            visibility: next.visibility,
            householdId,
            openingBalanceCents: next.openingBalanceCents,
            ...(iban !== undefined ? ibanColumns(next.iban) : {}),
            ...(archived !== undefined ? { archivedAt: archived ? (row.archivedAt ?? new Date()) : null } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(account.id, id), visibleTo(userId)))
          .returning();
        return { ok: true, account: toView(updated, userId) };
      });
    },

    async deleteAccount(caller: Caller, id: string): Promise<boolean> {
      return withSession(db, caller, async (tx, userId) => {
        const deleted = await tx
          .delete(account)
          .where(and(eq(account.id, id), visibleTo(userId)))
          .returning({ id: account.id });
        return deleted.length === 1;
      });
    },

    async householdHasSharedAccounts(tx: RlsTransaction, householdId: string): Promise<boolean> {
      const [row] = await tx
        .select({ id: account.id })
        .from(account)
        .where(eq(account.householdId, householdId))
        .limit(1);
      return Boolean(row);
    },
  };
}

