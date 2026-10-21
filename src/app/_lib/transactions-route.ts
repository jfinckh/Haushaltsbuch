import "server-only";
import type { Transactions } from "@/transactions/server";
import { asCaller, invalidInput, json, notFound, readJson, type GetCaller } from "./api";

type Deps = {
  transactions: Transactions;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

type IdContext = { params: Promise<{ id: string }> };

/**
 * Handlers for /api/transactions. Only bookings of accounts the caller may see exist for them: an
 * account or booking of another member's private account gets the same 404 as an unknown id.
 */
export function transactionsRoute({ transactions, getCaller }: Deps) {
  return {
    /** Query: accountId (required), month or from/to, kind, category, q. */
    async GET(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const query = Object.fromEntries(new URL(request.url).searchParams);
        const result = await transactions.listTransactions(caller, query);
        if (result.ok) return json({ transactions: result.transactions });
        return result.reason === "not-found" ? notFound() : invalidInput();
      });
    },

    async POST(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const result = await transactions.createTransaction(caller, await readJson(request));
        if (result.ok) return json({ transaction: result.transaction }, 201);
        return result.reason === "not-found" ? notFound() : invalidInput();
      });
    },
  };
}

/** Handlers for /api/transactions/[id]. */
export function transactionRoute({ transactions, getCaller }: Deps) {
  return {
    async GET(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const transaction = await transactions.getTransaction(caller, (await params).id);
        return transaction ? json({ transaction }) : notFound();
      });
    },

    async PATCH(request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const result = await transactions.updateTransaction(caller, (await params).id, await readJson(request));
        if (result.ok) return json({ transaction: result.transaction });
        return result.reason === "not-found" ? notFound() : invalidInput();
      });
    },

    async DELETE(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) =>
        (await transactions.deleteTransaction(caller, (await params).id)) ? json({ deleted: true }) : notFound(),
      );
    },
  };
}
