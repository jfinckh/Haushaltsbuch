import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Caller } from "@/shared/rls";
import { createImports, type Imports, type UploadInput } from "./create-imports";
import { createTestDatabase } from "./test-utils";

type Setup = Awaited<ReturnType<typeof createTestDatabase>>;

const ING = readFileSync(new URL("../../test-data/ing_testdaten.csv", import.meta.url));
const TR = readFileSync(new URL("../../test-data/traderepublic_testdaten.csv", import.meta.url));

let setup: Setup;
let imports: Imports;
let max: Caller;
let erika: Caller;
let dora: Caller;

const upload = (accountId: string, bytes: Uint8Array | Buffer = ING, fileName = "Umsatzanzeige.csv"): UploadInput => ({
  accountId,
  fileName,
  bytes: new Uint8Array(bytes),
});

/** The ING test file without its newest `drop` bookings (an older, overlapping export). */
function olderIngExport(drop: number): Uint8Array {
  const lines = ING.toString("utf8").split("\r\n");
  const header = lines.findIndex((line) => line.startsWith("Buchung;"));
  return new TextEncoder().encode([...lines.slice(0, header + 1), ...lines.slice(header + 1 + drop)].join("\r\n"));
}

async function confirm(caller: Caller, input: UploadInput) {
  const result = await imports.confirm(caller, input);
  if (!result.ok) throw new Error(`confirm failed: ${result.reason}`);
  return result;
}

async function preview(caller: Caller, input: UploadInput) {
  const result = await imports.preview(caller, input);
  if (!result.ok) throw new Error(`preview failed: ${result.reason}`);
  return result.preview;
}

beforeEach(async () => {
  setup = await createTestDatabase();
  imports = createImports({ db: setup.db, crypto: setup.crypto, transactions: setup.transactions });
  await setup.householdOf("home", "max", "erika");
  await setup.householdOf("other", "dora");
  await setup.addAccount("max-private", "max");
  await setup.addAccount("home-shared", "max", "home");
  await setup.addAccount("tr", "max");
  [max, erika, dora] = await Promise.all([setup.as("max"), setup.as("erika"), setup.as("dora")]);
});

describe("preview", () => {
  it("shows every row as new before the first import, and stores nothing", async () => {
    const result = await preview(max, upload("max-private"));
    expect(result).toMatchObject({
      bank: "ing",
      periodFrom: "2026-09-01",
      periodTo: "2026-10-15",
      counts: { rows: 29, new: 29, duplicate: 0, skipped: 0 },
      closingBalanceCents: 70326,
      openingBalanceFromFileCents: 180000,
    });
    expect(result.rows[0]).toEqual({
      line: 15,
      date: "2026-10-15",
      amountCents: -20000,
      kind: "expense",
      category: null,
      counterparty: "Trade Republic",
      reference: "Trade Republic 1a2b3c4d-0000-4000-8000-000000000003",
      status: "new",
    });
    expect(await setup.bookingsOf("max-private")).toEqual([]);
    expect(await imports.listImports(max)).toEqual([]);
  });

  it("has no opening balance for Trade Republic", async () => {
    expect(await preview(max, upload("tr", TR))).toMatchObject({
      bank: "trade_republic",
      counts: { rows: 18, new: 18 },
      closingBalanceCents: null,
      openingBalanceFromFileCents: null,
    });
  });

  it("passes parse errors on with their line", async () => {
    const broken = new TextEncoder().encode("Buchung;Valuta;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung\nxx");
    expect(await imports.preview(max, upload("max-private", broken))).toEqual({ ok: false, reason: "invalid-row", line: 2 });
    expect(await imports.preview(max, upload("max-private", new TextEncoder().encode("a,b")))).toEqual({
      ok: false,
      reason: "unknown-format",
    });
  });

  it("rejects a file of another bank than the account allows", async () => {
    const input = { ...upload("tr", ING), banks: ["trade_republic"] };
    expect(await imports.preview(max, input)).toEqual({ ok: false, reason: "wrong-bank" });
    expect(await imports.confirm(max, input)).toEqual({ ok: false, reason: "wrong-bank" });
    expect(await setup.bookingsOf("tr")).toEqual([]);
    expect(await imports.preview(max, { ...upload("tr", TR), banks: ["trade_republic"] })).toMatchObject({ ok: true });
  });

  it("rejects invalid input", async () => {
    expect(await imports.preview(max, { accountId: "", fileName: "x", bytes: new Uint8Array(ING) })).toEqual({
      ok: false,
      reason: "invalid-input",
    });
  });
});

describe("confirm", () => {
  it("creates the bookings and records the import", async () => {
    const result = await confirm(max, upload("max-private"));
    expect(result.import).toMatchObject({
      accountId: "max-private",
      bank: "ing",
      fileName: "Umsatzanzeige.csv",
      periodFrom: "2026-09-01",
      periodTo: "2026-10-15",
      rowCount: 29,
      newCount: 29,
      duplicateCount: 0,
      skippedCount: 0,
      remainingCount: 29,
      createdByMe: true,
    });
    expect(result.openingBalanceFromFileCents).toBe(180000);
    const bookings = await setup.bookingsOf("max-private");
    expect(bookings).toHaveLength(29);
    expect(bookings.reduce((sum, b) => sum + Number(b.amount_cents), 0)).toBe(-109674);
    expect([...result.bookingIds].sort()).toEqual(bookings.map((b) => b.id).sort());
  });

  it("returns no booking ids when nothing is new", async () => {
    await confirm(max, upload("max-private"));
    expect((await confirm(max, upload("max-private"))).bookingIds).toEqual([]);
  });

  it("creates nothing when the same file is imported twice", async () => {
    await confirm(max, upload("max-private"));
    expect((await preview(max, upload("max-private"))).counts).toEqual({ rows: 29, new: 0, duplicate: 29, merge: 0, skipped: 0 });
    const second = await confirm(max, upload("max-private"));
    expect(second.import).toMatchObject({ newCount: 0, duplicateCount: 29, remainingCount: 0 });
    expect(await setup.bookingsOf("max-private")).toHaveLength(29);
  });

  it("imports only the missing rows of an overlapping export", async () => {
    await confirm(max, upload("max-private", olderIngExport(5)));
    expect(await setup.bookingsOf("max-private")).toHaveLength(24);
    const result = await confirm(max, upload("max-private"));
    expect(result.import).toMatchObject({ newCount: 5, duplicateCount: 24 });
    expect(await setup.bookingsOf("max-private")).toHaveLength(29);
  });

  it("keeps both identical bakery bookings and brings back one deleted by hand", async () => {
    await confirm(max, upload("max-private"));
    const bakery = (await setup.bookingsOf("max-private")).filter((b) => b.booking_date === "2026-09-08");
    expect(bakery).toHaveLength(2);
    await setup.db.execute(sql`DELETE FROM "transaction" WHERE id = ${bakery[0].id}`);
    const again = await confirm(max, upload("max-private"));
    expect(again.import).toMatchObject({ newCount: 1, duplicateCount: 28 });
    expect((await setup.bookingsOf("max-private")).filter((b) => b.booking_date === "2026-09-08")).toHaveLength(2);
  });

  it("treats the same file in another account as new", async () => {
    await confirm(max, upload("max-private"));
    expect((await confirm(max, upload("home-shared"))).import.newCount).toBe(29);
  });

  it("books Trade Republic rows with their types", async () => {
    await confirm(max, upload("tr", TR));
    const kinds = (await setup.db.execute(
      sql`SELECT kind, count(*)::int AS n FROM "transaction" WHERE account_id = 'tr' GROUP BY kind ORDER BY kind`,
    )) as unknown as { rows: { kind: string; n: number }[] };
    expect(kinds.rows).toEqual([
      { kind: "expense", n: 5 },
      { kind: "income", n: 5 },
      { kind: "saving", n: 7 },
      { kind: "transfer", n: 1 },
    ]);
  });

  it("stores the file, its name and the raw rows only encrypted", async () => {
    await confirm(max, upload("max-private"));
    const stored = JSON.stringify(
      ((await setup.db.execute(sql`SELECT * FROM import`)) as unknown as { rows: unknown[] }).rows,
    ) + JSON.stringify(((await setup.db.execute(sql`SELECT * FROM import_row`)) as unknown as { rows: unknown[] }).rows);
    for (const plain of ["Umsatzanzeige", "Trade Republic", "MUSTERFIRMA", "DE94", "703,26", "Miete"]) {
      expect(stored).not.toContain(plain);
    }
  });
});

describe("list and undo", () => {
  it("lists imports newest first with the bookings still there", async () => {
    await confirm(max, upload("max-private", olderIngExport(5)));
    const newest = await confirm(max, upload("max-private"));
    const list = await imports.listImports(max);
    expect(list.map((i) => i.id)).toEqual([newest.import.id, expect.any(String)]);
    expect(list.map((i) => i.remainingCount)).toEqual([5, 24]);
    expect(await imports.listImports(max, "home-shared")).toEqual([]);
  });

  it("undoes an import as a whole and frees its rows", async () => {
    const first = await confirm(max, upload("max-private"));
    expect(await imports.undoImport(max, first.import.id)).toBe(true);
    expect(await setup.bookingsOf("max-private")).toEqual([]);
    expect(await imports.listImports(max)).toEqual([]);
    expect((await confirm(max, upload("max-private"))).import.newCount).toBe(29);
  });

  it("undo leaves bookings of other imports alone", async () => {
    await confirm(max, upload("max-private", olderIngExport(5)));
    const second = await confirm(max, upload("max-private"));
    await imports.undoImport(max, second.import.id);
    expect(await setup.bookingsOf("max-private")).toHaveLength(24);
  });

  it("returns false for unknown imports", async () => {
    expect(await imports.undoImport(max, "nope")).toBe(false);
  });
});

describe("privacy between members", () => {
  it("does not let a member preview or import into another member's private account", async () => {
    expect(await imports.preview(erika, upload("max-private"))).toEqual({ ok: false, reason: "not-found" });
    expect(await imports.confirm(erika, upload("max-private"))).toEqual({ ok: false, reason: "not-found" });
    expect(await imports.confirm(dora, upload("home-shared"))).toEqual({ ok: false, reason: "not-found" });
    expect(await setup.bookingsOf("max-private")).toEqual([]);
  });

  it("does not show or undo another member's private imports", async () => {
    const own = await confirm(max, upload("max-private"));
    expect(await imports.listImports(erika)).toEqual([]);
    expect(await imports.listImports(erika, "max-private")).toEqual([]);
    expect(await imports.undoImport(erika, own.import.id)).toBe(false);
    expect(await imports.undoImport(dora, own.import.id)).toBe(false);
    expect(await setup.bookingsOf("max-private")).toHaveLength(29);
  });

  it("shares imports of a shared account with the household", async () => {
    const shared = await confirm(max, upload("home-shared"));
    expect((await imports.listImports(erika)).map((i) => [i.id, i.createdByMe])).toEqual([[shared.import.id, false]]);
    expect((await preview(erika, upload("home-shared"))).counts.duplicate).toBe(29);
    expect(await imports.undoImport(erika, shared.import.id)).toBe(true);
    expect(await setup.bookingsOf("home-shared")).toEqual([]);
    expect(await imports.listImports(dora)).toEqual([]);
  });
});

describe("merging bookings entered by hand", () => {
  /** A booking entered by hand: the Trade Republic debit of line 15 (−200,00 on 2026-10-15), two days early. */
  async function manual(caller: Caller, accountId = "max-private", overrides: Record<string, unknown> = {}) {
    const result = await setup.transactions.createTransaction(caller, {
      accountId,
      date: "2026-10-13",
      amount: "-200,00",
      kind: "saving",
      category: null,
      counterparty: "Depot",
      reference: null,
      ...overrides,
    });
    if (!result.ok) throw new Error(result.reason);
    return result.transaction;
  }

  it("proposes the merge in the preview with the booking entered by hand", async () => {
    const booking = await manual(max);
    const result = await preview(max, upload("max-private"));
    expect(result.counts).toEqual({ rows: 29, new: 28, duplicate: 0, merge: 1, skipped: 0 });
    expect(result.rows.find((row) => row.line === 15)).toMatchObject({
      status: "merge",
      merge: { transactionId: booking.id, date: "2026-10-13", counterparty: "Depot", reference: null, kind: "saving", category: null },
    });
    expect(result.rows.filter((row) => row.status === "merge")).toHaveLength(1);
  });

  it("merges an accepted proposal: the booking takes the bank's data and keeps what was decided by hand", async () => {
    const booking = await manual(max);
    const result = await confirm(max, { ...upload("max-private"), merges: [{ line: 15, transactionId: booking.id }] });
    expect(result.import).toMatchObject({ newCount: 28, mergedCount: 1, duplicateCount: 0, remainingCount: 28, mergedRemainingCount: 1 });
    expect(result.mergedIds).toEqual([booking.id]);
    expect(result.bookingIds).not.toContain(booking.id);
    expect(await setup.bookingsOf("max-private")).toHaveLength(29);
    expect(await setup.transactions.getTransaction(max, booking.id)).toMatchObject({
      date: "2026-10-15",
      amountCents: -20000,
      kind: "saving",
      category: null,
      counterparty: "Trade Republic",
      reference: "Trade Republic 1a2b3c4d-0000-4000-8000-000000000003",
      createdByMe: true,
    });
    // The merged booking now has the row's fingerprint.
    expect((await preview(max, upload("max-private"))).counts).toMatchObject({ new: 0, duplicate: 29, merge: 0 });
  });

  it("imports a declined proposal as a new booking", async () => {
    const booking = await manual(max);
    const result = await confirm(max, upload("max-private"));
    expect(result.import).toMatchObject({ newCount: 29, mergedCount: 0 });
    expect(await setup.bookingsOf("max-private")).toHaveLength(30);
    expect(await setup.transactions.getTransaction(max, booking.id)).toMatchObject({ date: "2026-10-13", counterparty: "Depot" });
  });

  it("refuses an accepted pair that is not a proposal any more, and stores nothing", async () => {
    const booking = await manual(max);
    const other = await manual(max, "max-private", { date: "2026-10-01" });
    expect(await imports.confirm(max, { ...upload("max-private"), merges: [{ line: 15, transactionId: other.id }] })).toEqual({
      ok: false,
      reason: "preview-outdated",
    });
    await setup.transactions.deleteTransaction(max, booking.id);
    expect(await imports.confirm(max, { ...upload("max-private"), merges: [{ line: 15, transactionId: booking.id }] })).toEqual({
      ok: false,
      reason: "preview-outdated",
    });
    expect(await setup.bookingsOf("max-private")).toHaveLength(1);
    expect(await imports.listImports(max)).toEqual([]);
  });

  it("rejects a line accepted twice", async () => {
    const booking = await manual(max);
    const merges = [
      { line: 15, transactionId: booking.id },
      { line: 15, transactionId: booking.id },
    ];
    expect(await imports.confirm(max, { ...upload("max-private"), merges })).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("never proposes a booking that came from an import", async () => {
    await confirm(max, upload("max-private"));
    // The same debit a day later with another reference: a new row next to an imported booking of
    // the same amount, which has a fingerprint and so is no candidate.
    const changed = ING.toString("utf8").replace(
      "15.10.2026;15.10.2026;Trade Republic;Lastschrift;Trade Republic 1a2b3c4d-0000-4000-8000-000000000003",
      "16.10.2026;16.10.2026;Trade Republic;Lastschrift;Trade Republic 1a2b3c4d-0000-4000-8000-000000000009",
    );
    const result = await preview(max, upload("max-private", new TextEncoder().encode(changed)));
    expect(result.counts).toMatchObject({ new: 1, merge: 0 });
  });

  it("undo restores the merged booking as it was and deletes only the bookings the import created", async () => {
    const booking = await manual(max);
    const result = await confirm(max, { ...upload("max-private"), merges: [{ line: 15, transactionId: booking.id }] });
    expect(await imports.undoImport(max, result.import.id)).toBe(true);
    expect(await setup.transactions.getTransaction(max, booking.id)).toEqual(booking);
    expect(await setup.bookingsOf("max-private")).toEqual([expect.objectContaining({ id: booking.id })]);
    // A manual booking again: the next preview proposes the merge again.
    expect((await preview(max, upload("max-private"))).counts).toMatchObject({ new: 28, merge: 1 });
  });

  it("stores the values from before the merge only encrypted", async () => {
    const booking = await manual(max);
    await confirm(max, { ...upload("max-private"), merges: [{ line: 15, transactionId: booking.id }] });
    const result = (await setup.db.execute(
      sql`SELECT merged_from_encrypted FROM import_row WHERE transaction_id = ${booking.id}`,
    )) as unknown as { rows: { merged_from_encrypted: string }[] };
    expect(result.rows[0].merged_from_encrypted).toBeTruthy();
    expect(result.rows[0].merged_from_encrypted).not.toContain("Depot");
  });

  it("never proposes or changes another member's private bookings", async () => {
    await setup.addAccount("erika-private", "erika");
    const hidden = await manual(erika, "erika-private");
    const result = await preview(max, upload("max-private"));
    expect(result.counts.merge).toBe(0);
    expect(await imports.confirm(max, { ...upload("max-private"), merges: [{ line: 15, transactionId: hidden.id }] })).toEqual({
      ok: false,
      reason: "preview-outdated",
    });
    expect(await setup.transactions.getTransaction(erika, hidden.id)).toEqual(hidden);
  });

  it("proposes a booking another member entered in a shared account, and either may undo", async () => {
    const booking = await manual(erika, "home-shared");
    const result = await preview(max, upload("home-shared"));
    expect(result.rows.find((row) => row.line === 15)?.merge?.transactionId).toBe(booking.id);
    const done = await confirm(max, { ...upload("home-shared"), merges: [{ line: 15, transactionId: booking.id }] });
    expect(await setup.transactions.getTransaction(erika, booking.id)).toMatchObject({ date: "2026-10-15", createdByMe: true });
    expect(await imports.undoImport(erika, done.import.id)).toBe(true);
    expect(await setup.transactions.getTransaction(erika, booking.id)).toEqual(booking);
    expect(await imports.preview(dora, upload("home-shared"))).toEqual({ ok: false, reason: "not-found" });
  });
});
