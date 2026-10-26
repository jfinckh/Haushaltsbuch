import type { Caller, RlsTransaction } from "@/shared/rls";
import type { CategoryCatalog, GroupSpending } from "./categories";
import type { ClassifiedBy, TransactionKind } from "./kinds";
import type { CategoryScope, TransactionValues } from "./validation";

// The contract of the transactions part. Other parts depend on one of the three roles of the
// bookings: BookingService (pages and routes), BookingStore (other parts, inside their own
// database transaction) or BookingFigures (totals). createTransactions implements all three.
// Categories (own categories and hidden standard ones) is implemented by createCategories.

/** A booking as callers see it. The creator's user id is never sent. */
export type TransactionView = {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  kind: TransactionKind;
  category: string | null;
  counterparty: string | null;
  /** Formatted in groups of four, or null. */
  counterpartyIban: string | null;
  reference: string | null;
  createdByMe: boolean;
  /** Who set kind and category: the import or matching (auto), a rule, or a person (manual). */
  classifiedBy: ClassifiedBy;
};

/** One visible account, or all of the caller's own private accounts together (dashboard). */
export type AccountTarget = string | { ownPrivate: true };

/** Where a category is used: one visible account, or a whole rule scope (shared or private accounts). */
export type CategoryTarget = string | { visibility: "shared" | "private" };

type Failure = { ok: false; reason: "invalid-input" | "not-found" };

export type ListTransactionsResult =
  | { ok: true; transactions: TransactionView[]; total: { count: number; sumCents: number } }
  | Failure;

export type LatestTransactionsResult = { ok: true; transactions: TransactionView[] } | Failure;

export type SaveTransactionResult = { ok: true; transaction: TransactionView } | Failure;

/** Which bookings findBookings returns; all given criteria must hold. */
export type FindBookingsCriteria = {
  ids?: string[];
  accountId?: string;
  amountCents?: number;
  /** Booking dates, YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
  /** Only expenses and income without category that nobody classified by hand. */
  uncategorized?: boolean;
};

/** What an import gives a booking entered by hand when it merges a bank row into it. */
export type ImportedDetails = Pick<TransactionValues, "bookingDate" | "counterparty" | "counterpartyIban" | "reference">;

/** A booking's values before an import merged into it (undo restores them). */
export type MergedFrom = ImportedDetails & Pick<TransactionValues, "kind" | "category"> & { classifiedBy: ClassifiedBy };

/** What a rule sets on a booking. */
export type Classification = { id: string; kind: TransactionKind; category: string | null };

/** Income, expenses and saving of one calendar month (cents, signed as booked), and what is available. */
export type MonthSummary = { month: string; incomeCents: number; expenseCents: number; savingCents: number; availableCents: number };

export type MonthSummaryResult = ({ ok: true } & MonthSummary) | Failure;

export type MonthSummariesResult = { ok: true; months: MonthSummary[] } | Failure;

/** What was spent in one calendar month per category group (positive cents), largest first. */
export type MonthCategorySpending = { month: string; totalCents: number; groups: GroupSpending[] };

export type CategorySpendingResult = ({ ok: true } & MonthCategorySpending) | Failure;

export type CategorySpendingsResult = { ok: true; months: MonthCategorySpending[] } | Failure;

/** Bookings for pages and routes. Every call is about the caller's own view. */
export interface BookingService {
  /**
   * Bookings of one account, or of all own private accounts (`scope`), newest first, for a month, a
   * year or from/to; without any, the current calendar month. The search text is matched against
   * counterparty and reference after decryption, so only within the range. `total` covers all hits;
   * `limit` cuts the list after the search. With `kind=saving` within the own private accounts,
   * saving bookings on savings accounts are left out (the other side of one on an everyday account).
   */
  listTransactions(caller: Caller, query: unknown): Promise<ListTransactionsResult>;

  /** One booking, or null if it does not exist or the caller may not see its account. */
  getTransaction(caller: Caller, id: string): Promise<TransactionView | null>;

  /** Adds a booking to an account the caller may see; the caller is recorded as its creator. */
  createTransaction(caller: Caller, input: unknown): Promise<SaveTransactionResult>;

  /**
   * Changes a visible booking; omitted fields stay. Moving it needs the new account to be visible.
   * A category that no longer fits a new type is dropped.
   */
  updateTransaction(caller: Caller, id: string, input: unknown): Promise<SaveTransactionResult>;

  /** Deletes a visible booking; false if there is none the caller may see. */
  deleteTransaction(caller: Caller, id: string): Promise<boolean>;

  /**
   * The newest bookings of a visible account, any month, at most `limit` (1–50). With
   * `{ ownPrivate: true }`, of all of the caller's own private accounts together.
   */
  latestTransactions(caller: Caller, target: AccountTarget, limit: number): Promise<LatestTransactionsResult>;
}

/**
 * Booking methods for other parts, inside a database transaction they opened with withSession.
 * Row-level security applies: only bookings of visible accounts.
 */
export interface BookingStore {
  /**
   * Adds bookings (the import writes bookings and its fingerprints together). Each booking is
   * checked; invalid values throw. Created by `userId` (the session's user).
   */
  insertBookings(tx: RlsTransaction, userId: string, values: TransactionValues[]): Promise<string[]>;

  /** Whether a visible account has any bookings the caller may see. */
  hasBookings(tx: RlsTransaction, accountId: string): Promise<boolean>;

  /** Deletes the visible bookings among `ids`; returns how many. */
  deleteBookings(tx: RlsTransaction, ids: string[]): Promise<number>;

  /** Visible bookings by ids, and/or by account, exact amount and date range. Oldest first. */
  findBookings(tx: RlsTransaction, userId: string, criteria: FindBookingsCriteria): Promise<TransactionView[]>;

  /**
   * Whether `key` may be the category of a `kind` booking, budget or rule on the visible account
   * or rule scope `target` (budgets, rules). An archived own category only with `allowArchived`
   * (e.g. unchanged on an edited rule).
   */
  checkCategory(
    tx: RlsTransaction,
    target: CategoryTarget,
    kind: TransactionKind,
    key: string,
    options?: { allowArchived?: boolean },
  ): Promise<boolean>;

  /**
   * Sets the type of the visible bookings among `ids`; a category that does not fit the new type
   * is cleared. Only for decisions made by a person (transfers' manual actions), so the bookings
   * count as classified by hand. Returns how many changed.
   */
  setKind(tx: RlsTransaction, ids: string[], kind: TransactionKind): Promise<number>;

  /**
   * Merges an imported bank row into a visible booking entered by hand: the booking takes over
   * date, counterparty, IBAN and reference; amount, type, category, who classified it, its creator
   * and its id (so its transfer links) stay. Returns the values before, for undo, or null if the
   * caller may not see the booking. Invalid values throw.
   */
  mergeImported(tx: RlsTransaction, id: string, details: ImportedDetails): Promise<MergedFrom | null>;

  /**
   * Undoes mergeImported on a visible booking: date, counterparty, IBAN and reference go back.
   * Type, category and who classified go back too, unless a person classified the booking after
   * the merge (their decision stays). False if the caller may not see the booking.
   */
  restoreMerged(tx: RlsTransaction, id: string, previous: MergedFrom): Promise<boolean>;

  /**
   * Sets type and category as a rule decided: only visible bookings that nobody classified by
   * hand; they are marked as classified by rule. A category that does not fit its type throws.
   * Returns the ids that changed.
   */
  classifyBookings(tx: RlsTransaction, items: Classification[]): Promise<string[]>;

  /**
   * Net sum (cents) of a visible account's expenses per category key in a calendar month
   * (budgets). Negative means money spent; refunds booked as positive expenses lower it. Expenses
   * without category, income, transfers and saving are left out. Without a month, the current one.
   * An account the caller cannot see gives no totals.
   */
  expenseTotals(tx: RlsTransaction, accountId: string, month?: string): Promise<{ month: string; totals: Record<string, number> }>;
}

/** Totals of the bookings the caller may see. */
export interface BookingFigures {
  /**
   * Income, expenses and saving of a visible account in a calendar month (cents, signed as booked:
   * money out is negative), and what is available: their sum, i.e. income − expenses − saving.
   * Refunds lower the expenses; transfers never count. Without a month, the current one. With
   * `{ ownPrivate: true }`, over all of the caller's own private accounts together.
   */
  monthSummary(caller: Caller, target: AccountTarget, month?: string): Promise<MonthSummaryResult>;

  /**
   * The month summaries (as monthSummary) of `count` (1–24) calendar months ending with `until`
   * (default: the current month), newest first; a month without bookings gives zeros. With
   * `{ ownPrivate: true }`, saving bookings on savings accounts are left out: they are the other side
   * of a saving from an everyday account, which counts once.
   */
  monthSummaries(caller: Caller, target: AccountTarget, count: number, until?: string): Promise<MonthSummariesResult>;

  /**
   * What a visible account spent in a calendar month per category group (positive cents), largest
   * first; `group: null` is expenses without category. Only expenses count; refunds lower their
   * group, and a group at zero or below is left out. Without a month, the current one. With
   * `{ ownPrivate: true }`, over all of the caller's own private accounts together.
   */
  categorySpending(caller: Caller, target: AccountTarget, month?: string): Promise<CategorySpendingResult>;

  /**
   * The category spending (as categorySpending) of `count` (1–24) calendar months ending with
   * `until` (default: the current month), newest first; a month without expenses has no rows.
   */
  categorySpendings(caller: Caller, target: AccountTarget, count: number, until?: string): Promise<CategorySpendingsResult>;

  /** Sum of the bookings per visible account that has any (cents). The app adds the opening balance. */
  balances(caller: Caller): Promise<Record<string, number>>;
}

/** The whole transactions part. */
export interface Transactions extends BookingService, BookingStore, BookingFigures {}

/** An own category as callers see it. Its key is what bookings, rules and budgets store. */
export type CategoryView = {
  id: string;
  /** `c_<id>` for a group, `<group key>.c_<id>` for a subcategory. */
  key: string;
  scope: CategoryScope;
  kind: "expense" | "income";
  /** Null for a group; the standard or own group key for a subcategory. */
  parentKey: string | null;
  name: string;
  archived: boolean;
};

/** One scope's adjustments: hidden standard keys and own categories (archived ones included). */
export type CategoryScopeView = { hidden: string[]; categories: CategoryView[] };

export type ListCategoriesResult = {
  /** Null when the caller has no household. */
  household: CategoryScopeView | null;
  personal: CategoryScopeView;
};

export type SaveCategoryResult =
  | { ok: true; category: CategoryView }
  | { ok: false; reason: "invalid-input" | "not-found" | "duplicate" };

export type HideCategoryResult = { ok: true } | Failure;

/** Own categories and hidden standard ones, per household and per person. */
export interface Categories {
  /** The caller's household and personal adjustments. Personal ones are only ever the caller's own. */
  listCategories(caller: Caller): Promise<ListCategoriesResult>;

  /**
   * The names of every own category the caller may see (archived ones too) and the choices for a
   * shared account (standard minus the household's hidden ones, plus household categories) and for
   * one of the caller's private accounts (additionally minus their own hidden ones, plus their
   * personal categories). Archived ones are never offered.
   */
  catalog(caller: Caller): Promise<CategoryCatalog>;

  /** Adds an own group or subcategory to the household or to the caller only. */
  createCategory(caller: Caller, input: unknown): Promise<SaveCategoryResult>;

  /** Renames an own category the caller may see. */
  renameCategory(caller: Caller, id: string, input: unknown): Promise<SaveCategoryResult>;

  /**
   * Archives (true) or restores (false) an own category. Archived ones stay on bookings, rules and
   * budgets but are no longer offered for new ones.
   */
  setArchived(caller: Caller, id: string, archived: unknown): Promise<SaveCategoryResult>;

  /** Hides or shows a standard category key for the household or only for the caller. */
  setHidden(caller: Caller, input: unknown): Promise<HideCategoryResult>;
}
