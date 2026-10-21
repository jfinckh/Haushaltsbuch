import "server-only";
import type { Transfers } from "@/transfers/server";
import { asCaller, invalidInput, json, notFound, readJson, type GetCaller } from "./api";

type Deps = {
  transfers: Transfers;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

type IdContext = { params: Promise<{ id: string }> };

/**
 * Handlers for /api/transfers. Transfers exist only for bookings and accounts the caller may see:
 * another member's private account, booking or pair gets the same 404 as an unknown id, and a hidden
 * partner is described only by its owner.
 */
export function transfersRoute({ transfers, getCaller }: Deps) {
  return {
    /** Query: accountId (required). Open and proposed transfers of the account. */
    async GET(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const accountId = new URL(request.url).searchParams.get("accountId");
        if (!accountId || accountId.length > 100) return invalidInput();
        const overview = await transfers.accountOverview(caller, accountId);
        return overview ? json(overview) : notFound();
      });
    },
  };
}

/** Handlers for /api/transfers/[id] (id: a booking). */
export function transferRoute({ transfers, getCaller }: Deps) {
  return {
    async GET(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const status = await transfers.statusOf(caller, (await params).id);
        return status ? json({ status }) : notFound();
      });
    },

    /** Body: { action: "link", partnerId } | { action: "unlink" } | { action: "set-kind", kind } | { action: "no-partner", target }. */
    async POST(request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const { id } = await params;
        const result = await transfers.applyAction(caller, id, await readJson(request));
        if (result === "not-found") return notFound();
        if (result !== "ok") return invalidInput();
        return json({ status: await transfers.statusOf(caller, id) });
      });
    },
  };
}

/** Handlers for /api/transfers/proposals/[id] (id: a proposed pair). */
export function proposalRoute({ transfers, getCaller }: Deps) {
  return {
    /** Body: { action: "accept" | "reject" }. 409 when a side was linked in the meantime. */
    async POST(request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const result = await transfers.decideProposal(caller, (await params).id, await readJson(request));
        if (result === "ok") return json({ ok: true });
        if (result === "not-found") return notFound();
        if (result === "taken") return json({ error: "taken" }, 409);
        return invalidInput();
      });
    },
  };
}
