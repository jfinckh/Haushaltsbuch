import "server-only";
import type { Accounts } from "@/accounts/server";
import { asCaller, invalidInput, json, notFound, readJson, type GetCaller } from "./api";

type Deps = {
  accounts: Accounts;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

type IdContext = { params: Promise<{ id: string }> };

/**
 * Handlers for /api/accounts. Only accounts the caller may see exist for them: any other id, a
 * private account of another member included, gets the same 404 as an unknown one.
 */
export function accountsRoute({ accounts, getCaller }: Deps) {
  return {
    async GET() {
      return asCaller(getCaller, async (caller) => json({ accounts: await accounts.listAccounts(caller) }));
    },

    async POST(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const result = await accounts.createAccount(caller, await readJson(request));
        if (result.ok) return json({ accounts: result.accounts }, 201);
        if (result.reason === "no-household") return json({ error: "Create a household first to share accounts." }, 409);
        return invalidInput();
      });
    },
  };
}

/** Handlers for /api/accounts/[id]. */
export function accountRoute({ accounts, getCaller }: Deps) {
  return {
    async GET(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const account = await accounts.getAccount(caller, (await params).id);
        return account ? json({ account }) : notFound();
      });
    },

    async PATCH(request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const result = await accounts.updateAccount(caller, (await params).id, await readJson(request));
        if (result.ok) return json({ account: result.account });
        if (result.reason === "not-found") return notFound();
        if (result.reason === "not-owner") {
          return json({ error: "Only the person who added this account can change who sees it." }, 403);
        }
        if (result.reason === "no-household") return json({ error: "Create a household first to share accounts." }, 409);
        return invalidInput();
      });
    },

    async DELETE(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) =>
        (await accounts.deleteAccount(caller, (await params).id)) ? json({ deleted: true }) : notFound(),
      );
    },
  };
}
