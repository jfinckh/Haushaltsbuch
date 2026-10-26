import "server-only";
import type { Rules } from "@/rules/server";
import type { Caller } from "@/shared/rls";
import type { Transfers } from "@/transfers/server";
import { asCaller, invalidInput, json, notFound, readJson, type GetCaller } from "./api";

type Deps = {
  transfers: Pick<Transfers, "statusOf" | "accountOverview" | "applyAction" | "decideProposal">;
  /** Creates a rule when a transfer to an external own account is marked "Künftig immer so". */
  rules?: Pick<Rules, "createFromBooking">;
  /** The caller's household members with names: a hidden partner is shown by its owner's name. */
  members?: (caller: Caller) => Promise<{ userId: string; name: string }[]>;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

const membersOf = (deps: Deps, caller: Caller) => (deps.members ? deps.members(caller) : Promise.resolve([]));

type IdContext = { params: Promise<{ id: string }> };

/**
 * Handlers for /api/transfers. Transfers exist only for bookings and accounts the caller may see:
 * another member's private account, booking or pair gets the same 404 as an unknown id, and a hidden
 * partner is described only by its owner.
 */
export function transfersRoute(deps: Deps) {
  const { transfers, getCaller } = deps;
  return {
    /** Query: accountId (required). Open and proposed transfers of the account. */
    async GET(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const accountId = new URL(request.url).searchParams.get("accountId");
        if (!accountId || accountId.length > 100) return invalidInput();
        const overview = await transfers.accountOverview(caller, accountId, await membersOf(deps, caller));
        return overview ? json(overview) : notFound();
      });
    },
  };
}

/** A "no partner, external own account" action that asks to be remembered as a rule. */
function isExternalWithRule(body: unknown): body is { rule: unknown } {
  if (!body || typeof body !== "object" || !("rule" in body)) return false;
  const { action, target } = body as { action?: unknown; target?: { type?: unknown } };
  return action === "no-partner" && target?.type === "external";
}

/** Handlers for /api/transfers/[id] (id: a booking). */
export function transferRoute(deps: Deps) {
  const { transfers, rules, getCaller } = deps;
  return {
    async GET(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const status = await transfers.statusOf(caller, (await params).id, await membersOf(deps, caller));
        return status ? json({ status }) : notFound();
      });
    },

    /**
     * Body: { action: "link", partnerId } | { action: "unlink" } | { action: "set-kind", kind } |
     * { action: "no-partner", target }. With target external, `rule: { field, pattern }` also
     * creates a rule from the booking ("Künftig immer so").
     */
    async POST(request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const { id } = await params;
        const body = await readJson(request);
        const result = await transfers.applyAction(caller, id, body);
        if (result === "not-found") return notFound();
        if (result !== "ok") return invalidInput();
        const status = await transfers.statusOf(caller, id, await membersOf(deps, caller));
        if (rules && isExternalWithRule(body)) {
          const created = await rules.createFromBooking(caller, id, body.rule, "external");
          return json({ status, rule: { created: created.ok } });
        }
        return json({ status });
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
