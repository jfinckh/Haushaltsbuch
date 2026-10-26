import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { accountIsVisible, visibleAccount } from "@/db-contract/server";
import type { FieldCrypto } from "@/shared/field-crypto";
import { withSession, type Caller, type RlsDatabase, type RlsTransaction } from "@/shared/rls";
import type { BookingStore, MergedFrom, TransactionView } from "@/transactions/server";
import type { ConfirmResult, ImportFailure, Imports, ImportView, MergeTarget, PreviewResult, PreviewRow } from "./contract";
import { fingerprint } from "./fingerprint";
import { MERGE_DAYS, proposeMerges, shiftDate } from "./merge";
import { parseBankFile } from "./parsing/detect";
import type { ParsedFile, ParsedRow } from "./parsing/types";
import { importBatch, importRow } from "./schema";

export type ImportsOptions = {
  db: RlsDatabase;
  /** Encrypts the file, its name and the raw rows; makes the fingerprints. Keys come from the environment. */
  crypto: FieldCrypto;
  /** Writes and removes the bookings, inside the import's database transaction. */
  transactions: Pick<BookingStore, "findBookings" | "insertBookings" | "deleteBookings" | "mergeImported" | "restoreMerged">;
};

const CONTEXT = {
  file: "import.file",
  fileName: "import.fileName",
  rawRow: "import.rawRow",
  mergedFrom: "import.mergedFrom",
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
  merges: z
    .array(z.object({ line: z.number().int().positive(), transactionId: z.string().min(1).max(100) }))
    .max(10000)
    .refine(
      (merges) =>
        new Set(merges.map((m) => m.line)).size === merges.length &&
        new Set(merges.map((m) => m.transactionId)).size === merges.length,
    )
    .optional(),
});

/** Imports of accounts the session's user may see (accounts' database contract). RLS applies the same rule. */
const visible: SQL = visibleAccount(importBatch.accountId);

type ClassifiedRow = ParsedRow & { fingerprint: string; status: PreviewRow["status"]; merge?: TransactionView };

const mergeTarget = (booking: TransactionView): MergeTarget => ({
  transactionId: booking.id,
  date: booking.date,
  counterparty: booking.counterparty,
  reference: booking.reference,
  kind: booking.kind,
  category: booking.category,
});

/** The import part. Every call is about the caller's own view; their user id comes from the database. */
export function createImports({ db, crypto: fieldCrypto, transactions }: ImportsOptions): Imports {
  /**
   * Bookings entered by hand that new rows may merge with: visible bookings of the account around the
   * rows' dates without a fingerprint (no import created or merged into them).
   */
  async function mergeCandidates(tx: RlsTransaction, userId: string, accountId: string, rows: ParsedRow[]) {
    if (rows.length === 0) return [];
    const dates = rows.map((row) => row.bookingDate).sort();
    const bookings = await transactions.findBookings(tx, userId, {
      accountId,
      from: shiftDate(dates[0], -MERGE_DAYS),
      to: shiftDate(dates.at(-1)!, MERGE_DAYS),
    });
    if (bookings.length === 0) return [];
    const imported = await tx
      .select({ transactionId: importRow.transactionId })
      .from(importRow)
      .where(and(eq(importRow.accountId, accountId), inArray(importRow.transactionId, bookings.map((b) => b.id))));
    const fingerprinted = new Set(imported.map((row) => row.transactionId));
    return bookings.filter((booking) => !fingerprinted.has(booking.id));
  }

  /**
   * Marks rows whose fingerprint this account already has, or that came earlier in the same file, and
   * new rows that match a booking entered by hand (closest date first, one to one).
   */
  async function classify(tx: RlsTransaction, userId: string, accountId: string, file: ParsedFile): Promise<ClassifiedRow[]> {
    const rows = file.rows.map((row) => ({ ...row, fingerprint: fingerprint(fieldCrypto, accountId, file.bank, row.dedupKey) }));
    const known = new Set<string>();
    if (rows.length > 0) {
      const existing = await tx
        .select({ fingerprint: importRow.fingerprint })
        .from(importRow)
        .where(and(eq(importRow.accountId, accountId), inArray(importRow.fingerprint, rows.map((row) => row.fingerprint))));
      for (const row of existing) known.add(row.fingerprint);
    }
    const classified: ClassifiedRow[] = rows.map((row) => {
      const status = known.has(row.fingerprint) ? "duplicate" : "new";
      known.add(row.fingerprint);
      return { ...row, status };
    });
    const fresh = classified.filter((row) => row.status === "new");
    const candidates = await mergeCandidates(tx, userId, accountId, fresh);
    const byId = new Map(candidates.map((booking) => [booking.id, booking]));
    const merges = proposeMerges(fresh, candidates);
    return classified.map((row) => {
      const id = row.status === "new" ? merges.get(row.line) : undefined;
      return id ? { ...row, status: "merge", merge: byId.get(id) } : row;
    });
  }

  function summary(file: ParsedFile, rows: ClassifiedRow[]) {
    const dates = file.rows.map((row) => row.bookingDate).sort();
    const sum = file.rows.reduce((total, row) => total + row.amountCents, 0);
    const added = rows.filter((row) => row.status === "new").length;
    const merge = rows.filter((row) => row.status === "merge").length;
    return {
      periodFrom: dates[0] ?? null,
      periodTo: dates.at(-1) ?? null,
      counts: {
        rows: file.rows.length + file.skipped,
        new: added,
        duplicate: rows.length - added - merge,
        merge,
        skipped: file.skipped,
      },
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
      .select({
        batch: importBatch,
        remaining: sql<string>`count(${importRow.id}) FILTER (WHERE ${importRow.mergedFromEncrypted} IS NULL)`,
        mergedRemaining: sql<string>`count(${importRow.id}) FILTER (WHERE ${importRow.mergedFromEncrypted} IS NOT NULL)`,
      })
      .from(importBatch)
      .leftJoin(importRow, eq(importRow.importId, importBatch.id))
      .where(and(visible, where))
      .groupBy(importBatch.id)
      .orderBy(desc(importBatch.createdAt), desc(importBatch.id));
    return rows.map(({ batch, remaining, mergedRemaining }) => ({
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
      mergedCount: batch.mergedCount,
      remainingCount: Number(remaining),
      mergedRemainingCount: Number(mergedRemaining),
      createdByMe: batch.createdByUserId === userId,
    }));
  }

  return {
    async preview(caller: Caller, input: unknown): Promise<PreviewResult> {
      const read_ = read(input);
      if (!read_.ok) return read_;
      const { upload, file } = read_;
      return withSession(db, caller, async (tx, userId): Promise<PreviewResult> => {
        if (!(await accountIsVisible(tx, upload.accountId))) return { ok: false, reason: "not-found" };
        const rows = await classify(tx, userId, upload.accountId, file);
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
              ...(row.merge ? { merge: mergeTarget(row.merge) } : {}),
            })),
          },
        };
      });
    },

    async confirm(caller: Caller, input: unknown): Promise<ConfirmResult> {
      const read_ = read(input);
      if (!read_.ok) return read_;
      const { upload, file } = read_;
      return withSession(db, caller, async (tx, userId): Promise<ConfirmResult> => {
        if (!(await accountIsVisible(tx, upload.accountId))) return { ok: false, reason: "not-found" };
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`import:${upload.accountId}`}))`);
        const proposed = await classify(tx, userId, upload.accountId, file);
        const accepted = new Map((upload.merges ?? []).map((merge) => [merge.line, merge.transactionId]));
        for (const [line, transactionId] of accepted) {
          const row = proposed.find((candidate) => candidate.line === line);
          if (row?.status !== "merge" || row.merge?.id !== transactionId) return { ok: false, reason: "preview-outdated" };
        }
        // Proposals the user did not accept become new bookings.
        const rows = proposed.map((row): ClassifiedRow =>
          row.status === "merge" && !accepted.has(row.line) ? { ...row, status: "new", merge: undefined } : row,
        );
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
          mergedCount: counts.merge,
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
        const merged = rows.filter((row) => row.status === "merge");
        const mergedFrom: string[] = [];
        for (const row of merged) {
          const previous = await transactions.mergeImported(tx, row.merge!.id, {
            bookingDate: row.bookingDate,
            counterparty: row.counterparty,
            counterpartyIban: row.counterpartyIban,
            reference: row.reference,
          });
          // classify found it visible in this database transaction, so this cannot happen; roll back.
          if (!previous) throw new Error("Merge target disappeared");
          mergedFrom.push(fieldCrypto.encrypt(JSON.stringify(previous), CONTEXT.mergedFrom));
        }

        const rowValues = (row: ClassifiedRow, transactionId: string, mergedFromEncrypted: string | null) => ({
          id: crypto.randomUUID(),
          importId,
          accountId: upload.accountId,
          transactionId,
          fingerprint: row.fingerprint,
          line: row.line,
          rawEncrypted: fieldCrypto.encrypt(JSON.stringify(row.raw), CONTEXT.rawRow),
          mergedFromEncrypted,
        });
        const values = [
          ...fresh.map((row, index) => rowValues(row, bookingIds[index], null)),
          ...merged.map((row, index) => rowValues(row, row.merge!.id, mergedFrom[index])),
        ];
        if (values.length > 0) await tx.insert(importRow).values(values);

        const [view] = await views(tx, userId, eq(importBatch.id, importId));
        const mergedIds = merged.map((row) => row.merge!.id);
        return { ok: true, import: view, openingBalanceFromFileCents, bookingIds, mergedIds };
      });
    },

    async listImports(caller: Caller, accountId?: string): Promise<ImportView[]> {
      return withSession(db, caller, (tx, userId) =>
        views(tx, userId, accountId === undefined ? undefined : eq(importBatch.accountId, accountId)),
      );
    },

    async undoImport(caller: Caller, id: string): Promise<boolean> {
      return withSession(db, caller, async (tx) => {
        const [batch] = await tx
          .select({ id: importBatch.id })
          .from(importBatch)
          .where(and(eq(importBatch.id, id), visible));
        if (!batch) return false;
        const rows = await tx
          .select({ transactionId: importRow.transactionId, mergedFrom: importRow.mergedFromEncrypted })
          .from(importRow)
          .where(eq(importRow.importId, id));
        await transactions.deleteBookings(
          tx,
          rows.filter((row) => row.mergedFrom === null).map((row) => row.transactionId),
        );
        for (const row of rows) {
          if (row.mergedFrom === null) continue;
          const previous = JSON.parse(fieldCrypto.decrypt(row.mergedFrom, CONTEXT.mergedFrom)) as MergedFrom;
          await transactions.restoreMerged(tx, row.transactionId, previous);
        }
        const deleted = await tx
          .delete(importBatch)
          .where(and(eq(importBatch.id, id), visible))
          .returning({ id: importBatch.id });
        return deleted.length > 0;
      });
    },
  };
}

