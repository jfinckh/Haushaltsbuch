import type { Result } from "@/shared/result";
import type { Caller, RlsTransaction } from "@/shared/rls";
import type { AccountRole, AccountType, Bank, Visibility } from "./validation";

// The contract of the accounts part. createAccounts implements it.

/** An account as callers see it. The owner's user id is never sent. */
export type AccountView = {
  id: string;
  name: string;
  bank: Bank;
  type: AccountType;
  role: AccountRole;
  visibility: Visibility;
  openingBalanceCents: number;
  /** Formatted in groups of four, or null. */
  iban: string | null;
  archived: boolean;
  ownedByMe: boolean;
};

export type CreateAccountResult = Result<{ accounts: AccountView[] }, "invalid-input" | "no-household">;

export type UpdateAccountResult = Result<{ account: AccountView }, "invalid-input" | "not-found" | "no-household" | "not-owner">;

/** Accounts. Every call is about the caller's own view; their user id comes from the database. */
export interface Accounts {
  /** All accounts the caller may see, by name. */
  listAccounts(caller: Caller): Promise<AccountView[]>;

  /** One account, or null if it does not exist or the caller may not see it. */
  getAccount(caller: Caller, id: string): Promise<AccountView | null>;

  /**
   * Creates an account owned by the caller. With `{ setup: "trade-republic", ... }` it creates
   * Trade Republic's clearing account (everyday, with the IBAN) and depot (savings) together.
   * A shared account goes into the caller's household.
   */
  createAccount(caller: Caller, input: unknown): Promise<CreateAccountResult>;

  /**
   * Changes an account the caller may see. Any member may change a shared account; only the
   * owner may change its visibility. Making it shared puts it into the owner's household.
   */
  updateAccount(caller: Caller, id: string, input: unknown): Promise<UpdateAccountResult>;

  /** Deletes an account the caller may see. False if there is none. */
  deleteAccount(caller: Caller, id: string): Promise<boolean>;

  /**
   * For import, inside its database transaction: sets the opening balance (cents) of an account the
   * session's user `userId` may see. Returns the stored value, or null if the caller may not see it.
   */
  setOpeningBalance(tx: RlsTransaction, userId: string, accountId: string, cents: number): Promise<number | null>;

  /**
   * For households: whether a household holds shared accounts, so it must not be given up when
   * its only member switches households. Runs in the transaction households passes in, as
   * households_admin, through the SQL function accounts_household_has_accounts.
   */
  householdHasSharedAccounts(tx: RlsTransaction, householdId: string): Promise<boolean>;
}
