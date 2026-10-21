import "server-only";
import { z } from "zod";
import type { Accounts } from "@/accounts/server";
import type { Imports } from "@/import/server";
import { formatCents } from "@/shared/money";
import type { Caller } from "@/shared/rls";
import type { Transactions } from "@/transactions/server";
import { asCaller, json, notFound, type GetCaller } from "./api";

type Deps = {
  imports: Imports;
  accounts: Accounts;
  transactions: Transactions;
  /**
   * Runs after a confirmed import with the ids of its new bookings, e.g. transfer matching. Its own
   * database transaction: if it fails, the import stays.
   */
  afterImport?: (caller: Caller, bookingIds: string[]) => Promise<{ linked: number; proposed: number }>;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

type IdContext = { params: Promise<{ id: string }> };

/** Larger uploads are refused before they are read; the import part has its own, smaller limit. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Which bank exports fit an account of each bank. */
const FITTING_BANKS = {
  ing: ["ing"],
  trade_republic: ["trade_republic"],
  other: ["ing", "trade_republic"],
  cash: [],
} as const;

const uploadSchema = z.object({
  accountId: z.string().min(1).max(100),
  file: z.instanceof(File),
});

const failed = (reason: string, line?: number) =>
  reason === "not-found" ? notFound() : json({ error: reason, ...(line ? { line } : {}) }, 400);

/** The upload as the import part takes it, for an account the caller may see; else an error response. */
async function readUpload({ accounts, transactions }: Deps, caller: Caller, request: Request) {
  const form = await request.formData().catch(() => null);
  const parsed = uploadSchema.safeParse({ accountId: form?.get("accountId"), file: form?.get("file") });
  if (!parsed.success) return { ok: false as const, error: failed("invalid-input") };
  const { accountId, file } = parsed.data;
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false as const, error: failed("too-large") };
  // Another member's private account does not exist for this caller: same 404 as an unknown id.
  const account = await accounts.getAccount(caller, accountId);
  if (!account) return { ok: false as const, error: notFound() };
  const hasBookings = (await transactions.balances(caller))[accountId] !== undefined;
  const input = {
    accountId,
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    banks: [...FITTING_BANKS[account.bank]],
  };
  return { ok: true as const, input, hasBookings };
}

/**
 * Handlers for /api/imports. Imports exist only for accounts the caller may see: another member's
 * private account and its imports get the same 404 as unknown ids.
 */
export function importsRoute(deps: Deps) {
  const { imports, accounts, getCaller } = deps;
  return {
    /** Query: accountId (optional). */
    async GET(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const accountId = new URL(request.url).searchParams.get("accountId") || undefined;
        return json({ imports: await imports.listImports(caller, accountId) });
      });
    },

    /**
     * Confirms an import (multipart: accountId, file). Into an account without bookings it also sets
     * the opening balance, so the account's balance matches the file's saldo.
     */
    async POST(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const upload = await readUpload(deps, caller, request);
        if (!upload.ok) return upload.error;
        const result = await imports.confirm(caller, upload.input);
        if (!result.ok) return failed(result.reason, result.line);
        let openingBalanceCents: number | null = null;
        if (!upload.hasBookings && result.openingBalanceFromFileCents !== null && result.import.newCount > 0) {
          const updated = await accounts.updateAccount(caller, upload.input.accountId, {
            openingBalance: formatCents(result.openingBalanceFromFileCents),
          });
          if (updated.ok) openingBalanceCents = updated.account.openingBalanceCents;
        }
        let transfers: { linked: number; proposed: number } | null = null;
        if (deps.afterImport) {
          try {
            transfers = await deps.afterImport(caller, result.bookingIds);
          } catch (error) {
            // The import is done; matching can be redone by hand. Log no booking data.
            console.error("Transfer matching after import failed", error instanceof Error ? error.name : "unknown");
          }
        }
        return json({ import: result.import, openingBalanceCents, transfers }, 201);
      });
    },
  };
}

/** Handlers for /api/imports/preview. */
export function importPreviewRoute(deps: Deps) {
  const { imports, getCaller } = deps;
  return {
    /** What importing the file would do (multipart: accountId, file). Stores nothing. */
    async POST(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const upload = await readUpload(deps, caller, request);
        if (!upload.ok) return upload.error;
        const result = await imports.preview(caller, upload.input);
        if (!result.ok) return failed(result.reason, result.line);
        const cents = result.preview.openingBalanceFromFileCents;
        const willSet = !upload.hasBookings && cents !== null && result.preview.counts.new > 0;
        return json({ preview: result.preview, openingBalance: { willSet, cents: willSet ? cents : null } });
      });
    },
  };
}

/** Handlers for /api/imports/[id]. */
export function importRoute({ imports, getCaller }: Deps) {
  return {
    /** Undoes the import: deletes its bookings and the import. */
    async DELETE(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) =>
        (await imports.undoImport(caller, (await params).id)) ? json({ undone: true }) : notFound(),
      );
    },
  };
}
