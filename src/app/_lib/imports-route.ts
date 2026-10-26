import "server-only";
import { z } from "zod";
import type { Accounts } from "@/accounts/server";
import type { Imports } from "@/import/server";
import type { Caller } from "@/shared/rls";
import { asCaller, json, notFound, type GetCaller } from "./api";
import type { ImportWorkflow } from "./import-workflow";

type Deps = {
  imports: Pick<Imports, "preview" | "listImports" | "undoImport">;
  /** Confirms an upload and runs what follows it (rules, transfer matching). */
  workflow: Pick<ImportWorkflow, "confirm">;
  /** The account of an upload: whether the caller may see it, and which bank's files fit it. */
  accounts: Pick<Accounts, "getAccount">;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

type IdContext = { params: Promise<{ id: string }> };

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
async function readUpload({ accounts }: Pick<Deps, "accounts">, caller: Caller, request: Request) {
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
  const input = {
    accountId,
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    banks: [...FITTING_BANKS[account.bank]],
    merges,
  };
  return { ok: true as const, input };
}

/**
 * Handlers for /api/imports. Imports exist only for accounts the caller may see: another member's
 * private account and its imports get the same 404 as unknown ids.
 */
export function importsRoute({ imports, workflow, accounts, getCaller }: Deps) {
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
        const upload = await readUpload({ accounts }, caller, request);
        if (!upload.ok) return upload.error;
        const result = await workflow.confirm(caller, upload.input);
        if (!result.ok) return failed(result.reason, result.line);
        const { openingBalanceCents, transfers, rules } = result;
        return json({ import: result.import, openingBalanceCents, transfers, rules }, 201);
      });
    },
  };
}

/** Handlers for /api/imports/preview. */
export function importPreviewRoute({ imports, accounts, getCaller }: Omit<Deps, "workflow">) {
  return {
    /** What importing the file would do (multipart: accountId, file). Stores nothing. */
    async POST(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const upload = await readUpload({ accounts }, caller, request);
        if (!upload.ok) return upload.error;
        const result = await imports.preview(caller, upload.input);
        if (!result.ok) return failed(result.reason, result.line);
        return json({ preview: result.preview, openingBalance: result.openingBalance });
      });
    },
  };
}

/** Handlers for /api/imports/[id]. */
export function importRoute({ imports, getCaller }: Pick<Deps, "imports" | "getCaller">) {
  return {
    /** Undoes the import: deletes its bookings and the import. */
    async DELETE(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) =>
        (await imports.undoImport(caller, (await params).id)) ? json({ undone: true }) : notFound(),
      );
    },
  };
}
