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
    expect((await preview(max, upload("max-private"))).counts).toEqual({ rows: 29, new: 0, duplicate: 29, skipped: 0 });
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
