import "server-only";
import { z } from "zod";
import type { Accounts } from "@/accounts/server";
import type { Imports } from "@/import/server";
import { formatCents } from "@/shared/money";
import type { Caller } from "@/shared/rls";
import type { BookingFigures } from "@/transactions/server";
import { asCaller, json, notFound, type GetCaller } from "./api";

type Deps = {
  imports: Imports;
  accounts: Accounts;
  transactions: Pick<BookingFigures, "balances">;
  /**
   * Runs first after a confirmed import with the ids of its new bookings: the rules. Returns how many
   * bookings they sorted and which ones became transfers. Its own database transaction: if it
   * fails, the import stays.
   */
  applyRules?: (caller: Caller, bookingIds: string[]) => Promise<RulesApplied>;
  /**
   * Runs after the rules with the ids of the new bookings and the rules' transfers: transfer
   * matching. Its own database transaction: if it fails, the import stays.
   */
  afterImport?: (
    caller: Caller,
    bookingIds: string[],
    ruleTransfers: RulesApplied["transfers"],
  ) => Promise<{ linked: number; proposed: number }>;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

type IdContext = { params: Promise<{ id: string }> };

type RulesApplied = { applied: number; transfers: { id: string; target: "external" | null }[] };

/**
 * Larger request bodies are refused before they are read in full: the import part's 1 MB file limit
 * plus room for the form around it.
 */
export const MAX_UPLOAD_BYTES = 1024 * 1024 + 64 * 1024;

/** Which bank exports fit an account of each bank. */
const FITTING_BANKS = {
  ing: ["ing"],
  trade_republic: ["trade_republic"],
  other: ["ing", "trade_republic"],
  cash: [],
} as const;

/** The merge proposals the user accepted, as a JSON form field; the import part checks them against its own. */
const mergesSchema = z
  .string()
  .max(500_000)
  .transform((text, ctx) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "invalid-json" });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.object({ line: z.number().int().positive(), transactionId: z.string().min(1).max(100) })).max(10000));

const uploadSchema = z.object({
  accountId: z.string().min(1).max(100),
  file: z.instanceof(File),
  merges: mergesSchema.optional(),
});

const failed = (reason: string, line?: number) =>
  reason === "not-found"
    ? notFound()
    : json({ error: reason, ...(line ? { line } : {}) }, reason === "preview-outdated" ? 409 : 400);

/**
 * The request's form data, read only up to MAX_UPLOAD_BYTES: a larger declared size is refused at
 * once, and reading stops as soon as the body grows past the limit (also without or with a wrong
 * Content-Length). Null if it is not form data.
 */
async function readLimitedForm(request: Request): Promise<FormData | "too-large" | null> {
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES) return "too-large";
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPLOAD_BYTES) {
      await reader.cancel().catch(() => undefined);
      return "too-large";
    }
    chunks.push(new Uint8Array(value));
  }
  const headers = { "content-type": request.headers.get("content-type") ?? "" };
  return new Response(new Blob(chunks), { headers }).formData().catch(() => null);
}

/** The upload as the import part takes it, for an account the caller may see; else an error response. */
async function readUpload({ accounts, transactions }: Deps, caller: Caller, request: Request) {
  const form = await readLimitedForm(request);
  if (form === "too-large") return { ok: false as const, error: failed("too-large") };
  const parsed = uploadSchema.safeParse({
    accountId: form?.get("accountId"),
    file: form?.get("file"),
    merges: form?.get("merges") ?? undefined,
  });
  if (!parsed.success) return { ok: false as const, error: failed("invalid-input") };
  const { accountId, file, merges } = parsed.data;
  // Another member's private account does not exist for this caller: same 404 as an unknown id.
  const account = await accounts.getAccount(caller, accountId);
  if (!account) return { ok: false as const, error: notFound() };
  const hasBookings = (await transactions.balances(caller))[accountId] !== undefined;
  const input = {
    accountId,
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    banks: [...FITTING_BANKS[account.bank]],
    merges,
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
     * Confirms an import (multipart: accountId, file, merges: the accepted merge proposals as JSON).
     * Into an account without bookings it also sets the opening balance, so the account's balance
     * matches the file's saldo. 409 `preview-outdated` when an accepted merge is no longer proposed.
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
        // Rules first, then matching: matching may still link a booking a rule typed, but never
        // overrides a rule with its weaker "looks like a transfer" hint. Merged bookings go along: both
        // leave what a person decided as it is.
        const bookingIds = [...result.bookingIds, ...result.mergedIds];
        let rules: RulesApplied | null = null;
        if (deps.applyRules) {
          try {
            rules = await deps.applyRules(caller, bookingIds);
          } catch (error) {
            // The import is done; rules can be applied again on the rules page. Log no booking data.
            console.error("Applying rules after import failed", error instanceof Error ? error.name : "unknown");
          }
        }
        let transfers: { linked: number; proposed: number } | null = null;
        if (deps.afterImport) {
          try {
            transfers = await deps.afterImport(caller, bookingIds, rules?.transfers ?? []);
          } catch (error) {
            // The import is done; matching can be redone by hand. Log no booking data.
            console.error("Transfer matching after import failed", error instanceof Error ? error.name : "unknown");
          }
        }
        return json(
          { import: result.import, openingBalanceCents, transfers, rules: rules && { applied: rules.applied } },
          201,
        );
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
