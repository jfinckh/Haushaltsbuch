import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { FieldCrypto } from "@/shared/field-crypto";
import { withSession, type Caller, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import type { Transactions, TransactionValues } from "@/transactions/server";
import { fingerprint } from "./fingerprint";
import { parseBankFile } from "./parsing/detect";
import type { Bank, ParsedFile, ParsedRow, ParseErrorReason } from "./parsing/types";
import { importBatch, importRow } from "./schema";

export type ImportsOptions = {
  db: RlsDatabase;
  /** Encrypts the file, its name and the raw rows; makes the fingerprints. Keys come from the environment. */
  crypto: FieldCrypto;
  /** Writes and removes the bookings, inside the import's database transaction. */
  transactions: Transactions;
};

/** An uploaded file for an account; `banks`: the banks whose files fit the account (default: any). */
export type UploadInput = { accountId: string; fileName: string; bytes: Uint8Array; banks?: Bank[] };

export type PreviewRow = {
  line: number;
  date: string;
  amountCents: number;
  kind: TransactionValues["kind"];
  category: string | null;
  counterparty: string | null;
  reference: string | null;
  /** `duplicate`: already imported into this account (or twice in this file). */
  status: "new" | "duplicate";
};

export type ImportPreview = {
  bank: Bank;
  periodFrom: string | null;
  periodTo: string | null;
  counts: { rows: number; new: number; duplicate: number; skipped: number };
  /** Balance after the newest booking, if the export states it (ING). */
  closingBalanceCents: number | null;
  /** The opening balance that makes the account's balance match the file: closing balance − all its bookings. */
  openingBalanceFromFileCents: number | null;
  rows: PreviewRow[];
};

/** A confirmed import as callers see it. The creator's user id is never sent. */
export type ImportView = {
  id: string;
  accountId: string;
  bank: Bank;
  fileName: string;
  createdAt: string;
  periodFrom: string | null;
  periodTo: string | null;
  rowCount: number;
  newCount: number;
  duplicateCount: number;
  skippedCount: number;
  /** Bookings of this import that still exist. */
  remainingCount: number;
  createdByMe: boolean;
};

export type ImportFailure = {
  ok: false;
  reason: "invalid-input" | "not-found" | "wrong-bank" | ParseErrorReason;
  line?: number;
};
export type PreviewResult = { ok: true; preview: ImportPreview } | ImportFailure;
export type ConfirmResult =
  | {
      ok: true;
      import: ImportView;
      openingBalanceFromFileCents: number | null;
      /** The bookings this import created (e.g. for transfer matching). */
      bookingIds: string[];
    }
  | ImportFailure;

const CONTEXT = {
  file: "import.file",
  fileName: "import.fileName",
  rawRow: "import.rawRow",
} as const;

const uploadSchema = z.object({
  accountId: z.string().min(1).max(100),
  fileName: z
    .string()
    .trim()
    .max(255)
    .transform((name) => name || "upload.csv"),
  bytes: z.instanceof(Uint8Array),
  banks: z.array(z.enum(["ing", "trade_republic"])).optional(),
});

/** Imports of accounts the session's user may see (accounts' database contract). RLS applies the same rule. */
const visible: SQL = sql`${importBatch.accountId} IN (SELECT accounts_visible_account_ids())`;

async function accountIsVisible(tx: RlsTransaction, accountId: string): Promise<boolean> {
  const result = (await tx.execute(
    sql`SELECT 1 AS found WHERE ${accountId} IN (SELECT accounts_visible_account_ids())`,
  )) as unknown as { rows: unknown[] };
  return result.rows.length > 0;
}

type ClassifiedRow = ParsedRow & { fingerprint: string; status: "new" | "duplicate" };

/** The import part. Every call is about the caller's own view; their user id comes from the database. */
export function createImports({ db, crypto: fieldCrypto, transactions }: ImportsOptions) {
  /** Marks rows whose fingerprint this account already has, or that came earlier in the same file. */
  async function classify(tx: RlsTransaction, accountId: string, file: ParsedFile): Promise<ClassifiedRow[]> {
    const rows = file.rows.map((row) => ({ ...row, fingerprint: fingerprint(fieldCrypto, accountId, file.bank, row.dedupKey) }));
    const known = new Set<string>();
    if (rows.length > 0) {
      const existing = await tx
        .select({ fingerprint: importRow.fingerprint })
        .from(importRow)
        .where(and(eq(importRow.accountId, accountId), inArray(importRow.fingerprint, rows.map((row) => row.fingerprint))));
      for (const row of existing) known.add(row.fingerprint);
    }
    return rows.map((row) => {
      const status = known.has(row.fingerprint) ? "duplicate" : "new";
      known.add(row.fingerprint);
      return { ...row, status };
    });
  }

  function summary(file: ParsedFile, rows: ClassifiedRow[]) {
    const dates = file.rows.map((row) => row.bookingDate).sort();
    const sum = file.rows.reduce((total, row) => total + row.amountCents, 0);
    const added = rows.filter((row) => row.status === "new").length;
    return {
      periodFrom: dates[0] ?? null,
      periodTo: dates.at(-1) ?? null,
      counts: { rows: file.rows.length + file.skipped, new: added, duplicate: rows.length - added, skipped: file.skipped },
      openingBalanceFromFileCents: file.closingBalanceCents === null ? null : file.closingBalanceCents - sum,
    };
  }

  /** Validates and reads the upload; the account check happens in the caller's session. */
  function read(input: unknown): { ok: true; upload: z.infer<typeof uploadSchema>; file: ParsedFile } | ImportFailure {
    const parsed = uploadSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: "invalid-input" };
    const file = parseBankFile(parsed.data.bytes);
    if (!file.ok) return file;
    if (parsed.data.banks && !parsed.data.banks.includes(file.bank)) return { ok: false, reason: "wrong-bank" };
    return { ok: true, upload: parsed.data, file };
  }

  async function views(tx: RlsTransaction, userId: string, where: SQL | undefined): Promise<ImportView[]> {
    const rows = await tx
      .select({ batch: importBatch, remaining: count(importRow.id) })
      .from(importBatch)
      .leftJoin(importRow, eq(importRow.importId, importBatch.id))
      .where(and(visible, where))
      .groupBy(importBatch.id)
      .orderBy(desc(importBatch.createdAt), desc(importBatch.id));
    return rows.map(({ batch, remaining }) => ({
      id: batch.id,
      accountId: batch.accountId,
      bank: batch.bank,
      fileName: fieldCrypto.decrypt(batch.fileNameEncrypted, CONTEXT.fileName),
      createdAt: batch.createdAt.toISOString(),
      periodFrom: batch.periodFrom,
      periodTo: batch.periodTo,
      rowCount: batch.rowCount,
      newCount: batch.newCount,
      duplicateCount: batch.duplicateCount,
      skippedCount: batch.skippedCount,
      remainingCount: remaining,
      createdByMe: batch.createdByUserId === userId,
    }));
  }

  return {
    /** What importing the file into the account would do. Stores nothing. */
    async preview(caller: Caller, input: unknown): Promise<PreviewResult> {
      const read_ = read(input);
      if (!read_.ok) return read_;
      const { upload, file } = read_;
      return withSession(db, caller, async (tx): Promise<PreviewResult> => {
        if (!(await accountIsVisible(tx, upload.accountId))) return { ok: false, reason: "not-found" };
        const rows = await classify(tx, upload.accountId, file);
        return {
          ok: true,
          preview: {
            bank: file.bank,
            closingBalanceCents: file.closingBalanceCents,
            ...summary(file, rows),
            rows: rows.map((row) => ({
              line: row.line,
              date: row.bookingDate,
              amountCents: row.amountCents,
              kind: row.kind,
              category: row.category,
              counterparty: row.counterparty,
              reference: row.reference,
              status: row.status,
            })),
          },
        };
      });
    },

    /**
     * Imports the file: creates the bookings of the new rows, records their fingerprints and raw rows
     * and the import itself, all in one database transaction. Imports into the same account run one
     * after the other, so two uploads at once cannot create the same booking twice.
     */
    async confirm(caller: Caller, input: unknown): Promise<ConfirmResult> {
      const read_ = read(input);
      if (!read_.ok) return read_;
      const { upload, file } = read_;
      return withSession(db, caller, async (tx, userId): Promise<ConfirmResult> => {
        if (!(await accountIsVisible(tx, upload.accountId))) return { ok: false, reason: "not-found" };
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`import:${upload.accountId}`}))`);
        const rows = await classify(tx, upload.accountId, file);
        const { counts, periodFrom, periodTo, openingBalanceFromFileCents } = summary(file, rows);
        const importId = crypto.randomUUID();

        await tx.insert(importBatch).values({
          id: importId,
          accountId: upload.accountId,
          bank: file.bank,
          fileNameEncrypted: fieldCrypto.encrypt(upload.fileName, CONTEXT.fileName),
          fileEncrypted: fieldCrypto.encrypt(new TextDecoder().decode(upload.bytes), CONTEXT.file),
          periodFrom,
          periodTo,
          rowCount: counts.rows,
          newCount: counts.new,
          duplicateCount: counts.duplicate,
          skippedCount: counts.skipped,
          createdByUserId: userId,
        });

        const fresh = rows.filter((row) => row.status === "new");
        const bookingIds = await transactions.insertBookings(
          tx,
          userId,
          fresh.map((row) => ({
            accountId: upload.accountId,
            bookingDate: row.bookingDate,
            amountCents: row.amountCents,
            kind: row.kind,
            category: row.category,
            counterparty: row.counterparty,
            counterpartyIban: row.counterpartyIban,
            reference: row.reference,
          })),
        );
        if (fresh.length > 0) {
          await tx.insert(importRow).values(
            fresh.map((row, index) => ({
              id: crypto.randomUUID(),
              importId,
              accountId: upload.accountId,
              transactionId: bookingIds[index],
              fingerprint: row.fingerprint,
              line: row.line,
              rawEncrypted: fieldCrypto.encrypt(JSON.stringify(row.raw), CONTEXT.rawRow),
            })),
          );
        }

        const [view] = await views(tx, userId, eq(importBatch.id, importId));
        return { ok: true, import: view, openingBalanceFromFileCents, bookingIds };
      });
    },

    /** Imports of all visible accounts, or of one, newest first. */
    async listImports(caller: Caller, accountId?: string): Promise<ImportView[]> {
      return withSession(db, caller, (tx, userId) =>
        views(tx, userId, accountId === undefined ? undefined : eq(importBatch.accountId, accountId)),
      );
    },

    /** Removes a visible import with all its bookings; false if there is none the caller may see. */
    async undoImport(caller: Caller, id: string): Promise<boolean> {
      return withSession(db, caller, async (tx) => {
        const [batch] = await tx
          .select({ id: importBatch.id })
          .from(importBatch)
          .where(and(eq(importBatch.id, id), visible));
        if (!batch) return false;
        const rows = await tx.select({ transactionId: importRow.transactionId }).from(importRow).where(eq(importRow.importId, id));
        await transactions.deleteBookings(tx, rows.map((row) => row.transactionId));
        const deleted = await tx
          .delete(importBatch)
          .where(and(eq(importBatch.id, id), visible))
          .returning({ id: importBatch.id });
        return deleted.length > 0;
      });
    },
  };
}

export type Imports = ReturnType<typeof createImports>;
