import "server-only";
import type { Recurring } from "@/recurring/server";
import type { Rules } from "@/rules/server";
import type { BookingService } from "@/transactions/server";
import type { Transfers } from "@/transfers/server";
import { asCaller, invalidInput, json, notFound, readJson, type GetCaller } from "./api";

type Deps = {
  transactions: BookingService;
  /** Records a type changed in the booking form as a manual transfer decision. */
  transfers?: Pick<Transfers, "setKind">;
  /** Creates a rule from the booking when the form asks for it ("Künftig immer so"). */
  rules?: Pick<Rules, "createFromBooking">;
  /** Creates booking and template together when a new booking carries `repeat` ("Regelmäßig wiederholen"). */
  recurring?: Pick<Recurring, "createWithBooking">;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

type IdContext = { params: Promise<{ id: string }> };

/**
 * Handlers for /api/transactions. Only bookings of accounts the caller may see exist for them: an
 * account or booking of another member's private account gets the same 404 as an unknown id.
 */
export function transactionsRoute({ transactions, recurring, getCaller }: Deps) {
  return {
    /**
     * Query: accountId or scope=own-private (exactly one), month / year / from+to, kind, category (or
     * "none"), q, limit. Response: `{ transactions, total }`, the total covering all hits.
     */
    async GET(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const query = Object.fromEntries(new URL(request.url).searchParams);
        const result = await transactions.listTransactions(caller, query);
        if (result.ok) return json({ transactions: result.transactions, total: result.total });
        return result.reason === "not-found" ? notFound() : invalidInput();
      });
    },

    /** Body: the booking; with `repeat: { intervalMonths, endDate }` also its template (201 with `templateId`). */
    async POST(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const body = await readJson(request);
        if (recurring && body && typeof body === "object" && "repeat" in body) {
          const result = await recurring.createWithBooking(caller, body);
          if (result.ok) return json({ transaction: result.transaction, templateId: result.templateId }, 201);
          return result.reason === "not-found" ? notFound() : invalidInput();
        }
        const result = await transactions.createTransaction(caller, body);
        if (result.ok) return json({ transaction: result.transaction }, 201);
        return result.reason === "not-found" ? notFound() : invalidInput();
      });
    },
  };
}

/** Handlers for /api/transactions/[id]. */
export function transactionRoute({ transactions, transfers, rules, getCaller }: Deps) {
  return {
    async GET(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const transaction = await transactions.getTransaction(caller, (await params).id);
        return transaction ? json({ transaction }) : notFound();
      });
    },

    /** Body: the changed fields; optionally `rule: { field, pattern }` to remember the change as a rule. */
    async PATCH(request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const { id } = await params;
        const body = await readJson(request);
        const before = transfers && (await transactions.getTransaction(caller, id));
        const result = await transactions.updateTransaction(caller, id, body);
        if (!result.ok) return result.reason === "not-found" ? notFound() : invalidInput();
        let transaction = result.transaction;
        if (transfers && before && before.kind !== transaction.kind) {
          // A type changed by hand wins over matching, and expense or income dissolves a link.
          await transfers.setKind(caller, id, transaction.kind);
          transaction = (await transactions.getTransaction(caller, id)) ?? transaction;
        }
        const learn = body && typeof body === "object" && "rule" in body ? body.rule : undefined;
        if (rules && learn !== undefined) {
          const created = await rules.createFromBooking(caller, id, learn);
          return json({ transaction, rule: { created: created.ok } });
        }
        return json({ transaction });
      });
    },

    async DELETE(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) =>
        (await transactions.deleteTransaction(caller, (await params).id)) ? json({ deleted: true }) : notFound(),
      );
    },
  };
}
