import { beforeEach, describe, expect, it } from "vitest";
import type { Caller } from "@/shared/rls";
import { createTestDatabase, ING_IBAN, ING_ROWS, TR_ROWS } from "./test-utils";

type Setup = Awaited<ReturnType<typeof createTestDatabase>>;

let setup: Setup;
let max: Caller;
let erika: Caller;
let dora: Caller;

async function prepare(today?: string) {
  setup = await createTestDatabase({ today });
  await setup.householdOf("home", "max", "erika");
  await setup.householdOf("other", "dora");
  await setup.addAccount("ing", "max", { iban: ING_IBAN });
  await setup.addAccount("tr", "max", { bank: "trade_republic" });
  await setup.addAccount("shared", "erika", { householdId: "home" });
  await setup.addAccount("erika-ing", "erika");
  await setup.addAccount("dora-ing", "dora");
  [max, erika, dora] = await Promise.all([setup.as("max"), setup.as("erika"), setup.as("dora")]);
}

/** Booking ids of the ING and TR rows by date and amount, e.g. ing("2026-10-14", -100000). */
async function importTestData(order: "ing-first" | "tr-first" = "ing-first") {
  const steps = [
    () => setup.importBookings("max", "ing", ING_ROWS),
    () => setup.importBookings("max", "tr", TR_ROWS),
  ];
  const [first, second] = order === "ing-first" ? steps : steps.reverse();
  const a = await first();
  const b = await second();
  const [ingResult, trResult] = order === "ing-first" ? [a, b] : [b, a];
  const pick = (rows: typeof ING_ROWS, ids: string[]) => (date: string, cents: number) =>
    ids[rows.findIndex((row) => row.date === date && row.amountCents === cents)];
  return { ing: pick(ING_ROWS, ingResult.ids), tr: pick(TR_ROWS, trResult.ids), results: [a.result, b.result] };
}

beforeEach(async () => {
  await prepare();
});

describe("matching the test data", () => {
  for (const order of ["ing-first", "tr-first"] as const) {
    it(`links ING → Trade Republic, whatever is imported first (${order})`, async () => {
      const { ing, tr, results } = await importTestData(order);
      expect(results[1]).toEqual({ linked: 2, proposed: 0 });
      const pairs = await setup.pairs();
      expect(pairs).toHaveLength(2);
      expect(pairs).toEqual(
        expect.arrayContaining([
          { out: ing("2026-09-30", -90000), in: tr("2026-10-02", 90000), status: "linked", manual: false },
          { out: ing("2026-10-14", -100000), in: tr("2026-10-15", 100000), status: "linked", manual: false },
        ]),
      );
      for (const id of [ing("2026-09-30", -90000), tr("2026-10-02", 90000), ing("2026-10-14", -100000), tr("2026-10-15", 100000)]) {
        expect(await setup.kindOf(id)).toBe("transfer");
      }
    });
  }

  it("keeps the other cases open as transfers and leaves ordinary bookings alone", async () => {
    const { ing, tr } = await importTestData();
    const overview = (await setup.transfers.accountOverview(max, "ing"))!;
    const open = overview.open.map((b) => `${b.date} ${b.amountCents}`).sort();
    expect(open).toEqual([
      "2026-09-01 -120000",
      "2026-09-15 50000",
      "2026-10-01 -120000",
      "2026-10-05 15000",
      "2026-10-15 -20000",
    ]);
    expect(overview.proposals).toEqual([]);
    expect(await setup.kindOf(ing("2026-10-15", -20000))).toBe("transfer");
    expect(await setup.kindOf(ing("2026-10-02", -149))).toBe("expense");
    expect(await setup.kindOf(tr("2026-10-03", -5000))).toBe("expense");
    expect(await setup.kindOf(tr("2026-09-02", -25000))).toBe("saving");
  });

  it("marks open transfers older than 14 days", async () => {
    await prepare("2026-10-30");
    const { ing } = await importTestData();
    const status = (await setup.transfers.statusOf(max, ing("2026-10-15", -20000)))!;
    expect(status).toMatchObject({ isTransfer: true, open: true, overdue: true, link: null });
    const overview = (await setup.transfers.accountOverview(max, "ing"))!;
    expect(overview.open.every((b) => b.overdue)).toBe(true);
  });

  it("does not mark an open transfer before 14 days have passed", async () => {
    const { ing } = await importTestData();
    expect(await setup.transfers.statusOf(max, ing("2026-10-15", -20000))).toMatchObject({ open: true, overdue: false });
  });

  it("links the rent to the shared account's counter-booking of the same month only", async () => {
    const { ing } = await importTestData();
    const shared = await setup.importBookings("erika", "shared", [
      { date: "2026-09-01", amountCents: 120000, counterparty: "Max Mustermann", reference: "Miete und co" },
      { date: "2026-10-02", amountCents: 120000, counterparty: "Max Mustermann", reference: "Miete und co" },
    ]);
    expect(shared.result).toEqual({ linked: 2, proposed: 0 });
    const pairs = await setup.pairs();
    expect(pairs).toEqual(
      expect.arrayContaining([
        { out: ing("2026-09-01", -120000), in: shared.ids[0], status: "linked", manual: false },
        { out: ing("2026-10-01", -120000), in: shared.ids[1], status: "linked", manual: false },
      ]),
    );
  });
});

describe("what each member sees", () => {
  it("shows the shared side to Erika with only the owner of Max's private side", async () => {
    const { ing } = await importTestData();
    const shared = await setup.importBookings("erika", "shared", [
      { date: "2026-09-01", amountCents: 120000, counterparty: "Max Mustermann", reference: "Miete und co" },
    ]);
    const status = (await setup.transfers.statusOf(erika, shared.ids[0]))!;
    expect(status.link).toEqual({
      pairId: expect.any(String),
      status: "linked",
      manual: false,
      partner: { visible: false, ownerUserId: "max" },
    });
    expect(status.candidates).toEqual([]);
    const json = JSON.stringify(status);
    expect(json).not.toContain(ing("2026-09-01", -120000));
    expect(json).not.toContain('"ing"');

    const maxView = (await setup.transfers.statusOf(max, ing("2026-09-01", -120000)))!;
    expect(maxView.link?.partner).toMatchObject({ visible: true, booking: { id: shared.ids[0], accountId: "shared" } });
  });

  it("gives Erika nothing about Max's private bookings and pairs", async () => {
    const { ing, tr } = await importTestData();
    const id = ing("2026-10-14", -100000);
    expect(await setup.transfers.statusOf(erika, id)).toBeNull();
    expect(await setup.transfers.accountOverview(erika, "ing")).toBeNull();
    expect(await setup.transfers.link(erika, id, tr("2026-10-15", 100000))).toBe("not-found");
    expect(await setup.transfers.unlink(erika, id)).toBe(false);
    expect(await setup.transfers.setKind(erika, id, "expense")).toBe(false);
    expect(await setup.transfers.markWithoutPartner(erika, id, { type: "external" })).toBe("not-found");
    const pairId = (await setup.transfers.statusOf(max, id))!.link!.pairId;
    expect(await setup.transfers.acceptProposal(erika, pairId)).toBe("not-found");
    expect(await setup.transfers.rejectProposal(erika, pairId)).toBe(false);
    expect((await setup.pairs()).filter((p) => p.status === "linked")).toHaveLength(2);
    expect(await setup.kindOf(id)).toBe("transfer");
  });

  it("never links bookings of another household", async () => {
    await setup.importBookings("max", "ing", [ING_ROWS[1]]);
    const dorasImport = await setup.importBookings("dora", "dora-ing", [
      { date: "2026-10-14", amountCents: 100000, counterparty: "Max Mustermann", reference: `Top up with ${ING_IBAN}` },
    ]);
    expect(dorasImport.result).toEqual({ linked: 0, proposed: 0 });
    expect(await setup.pairs()).toEqual([]);
    expect(await setup.transfers.statusOf(dora, dorasImport.ids[0])).toMatchObject({ candidates: [] });
  });
});

describe("several candidates", () => {
  it("proposes instead of linking when name and date do not decide", async () => {
    const [out] = (await setup.importBookings("max", "ing", [ING_ROWS[1]])).ids;
    const { ids, result } = await setup.importBookings("max", "tr", [
      { date: "2026-10-13", amountCents: 100000, counterpartyIban: ING_IBAN },
      { date: "2026-10-15", amountCents: 100000, counterpartyIban: ING_IBAN },
    ]);
    expect(result).toEqual({ linked: 0, proposed: 2 });
    const status = (await setup.transfers.statusOf(max, out))!;
    expect(status.link).toBeNull();
    expect(status.proposals.map((p) => p.partner)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ visible: true, booking: expect.objectContaining({ id: ids[0] }) }),
        expect.objectContaining({ visible: true, booking: expect.objectContaining({ id: ids[1] }) }),
      ]),
    );
    const chosen = status.proposals.find((p) => p.partner.visible && p.partner.booking.id === ids[1])!;
    expect(await setup.transfers.acceptProposal(max, chosen.pairId)).toBe("ok");
    const after = (await setup.transfers.statusOf(max, out))!;
    expect(after.link).toMatchObject({ manual: true, partner: { visible: true, booking: { id: ids[1] } } });
    expect(after.proposals).toEqual([]);
    expect(await setup.transfers.statusOf(max, ids[0])).toMatchObject({ link: null, proposals: [] });
  });

  it("lets the name decide between two members paying the same into the shared account", async () => {
    const shared = await setup.importBookings("erika", "shared", [
      { date: "2026-10-01", amountCents: 50000, counterparty: "Max Mustermann" },
      { date: "2026-10-01", amountCents: 50000, counterparty: "Erika Mustermann" },
    ]);
    const maxs = await setup.importBookings("max", "ing", [{ date: "2026-10-01", amountCents: -50000, counterparty: "Max Mustermann" }]);
    const erikas = await setup.importBookings("erika", "erika-ing", [
      { date: "2026-10-01", amountCents: -50000, counterparty: "Max Mustermann" },
    ]);
    expect(maxs.result).toEqual({ linked: 1, proposed: 0 });
    expect(erikas.result).toEqual({ linked: 1, proposed: 0 });
    expect(await setup.pairs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ out: maxs.ids[0], in: shared.ids[0], status: "linked" }),
        expect.objectContaining({ out: erikas.ids[0], in: shared.ids[1], status: "linked" }),
      ]),
    );
  });

  it("only proposes a candidate without any hint", async () => {
    const [out] = (await setup.importBookings("max", "ing", [ING_ROWS[0]])).ids;
    // "Trade Republic" does not point at the shared ING account, and the counter-booking has no text.
    const { ids, result } = await setup.importBookings("erika", "shared", [{ date: "2026-10-16", amountCents: 20000 }]);
    expect(result).toEqual({ linked: 0, proposed: 1 });
    expect((await setup.transfers.statusOf(max, out))!.proposals[0].partner).toMatchObject({ booking: { id: ids[0] } });
  });
});

describe("depot movements", () => {
  it("does not propose a savings plan purchase as the partner of a member's payment", async () => {
    await setup.importBookings("max", "ing", [ING_ROWS[2]]);
    const tr = await setup.importBookings("max", "tr", [
      { date: "2026-10-02", amountCents: -15000, kind: "saving", reference: "Savings plan execution IE00BKM4GZ66" },
    ]);
    expect(tr.result).toEqual({ linked: 0, proposed: 0 });
  });

  it("never links a savings plan purchase, even when the name points at its account", async () => {
    await setup.importBookings("erika", "erika-ing", [{ date: "2026-10-05", amountCents: 15000, counterparty: "Erika Mustermann" }]);
    await setup.addAccount("erika-tr", "erika", { bank: "trade_republic" });
    const tr = await setup.importBookings("erika", "erika-tr", [
      { date: "2026-10-02", amountCents: -15000, kind: "saving", reference: "Savings plan execution IE00BKM4GZ66" },
    ]);
    expect(tr.result).toEqual({ linked: 0, proposed: 0 });
    expect(await setup.kindOf(tr.ids[0])).toBe("saving");
  });
});

describe("saving", () => {
  it("gives both sides the type saving from an everyday to a savings account", async () => {
    await setup.addAccount("tagesgeld", "max", { bank: "other", role: "savings", iban: "DE89370400440532013000" });
    const out = await setup.importBookings("max", "ing", [
      { date: "2026-10-10", amountCents: -30000, counterparty: "Max Mustermann", counterpartyIban: "DE89 3704 0044 0532 0130 00" },
    ]);
    const into = await setup.importBookings("max", "tagesgeld", [{ date: "2026-10-11", amountCents: 30000 }]);
    expect(into.result).toEqual({ linked: 1, proposed: 0 });
    expect(await setup.kindOf(out.ids[0])).toBe("saving");
    expect(await setup.kindOf(into.ids[0])).toBe("saving");
  });
});

describe("manual decisions win", () => {
  it("marks a booking as a transfer from an external own account", async () => {
    const { ing } = await importTestData();
    const id = ing("2026-09-15", 50000);
    expect(await setup.transfers.markWithoutPartner(max, id, { type: "external" })).toBe("ok");
    expect(await setup.transfers.statusOf(max, id)).toMatchObject({
      isTransfer: true,
      open: false,
      decision: { type: "no-partner", target: "external" },
    });
    expect(await setup.kindOf(id)).toBe("transfer");
    // A later counter-booking is not linked to it.
    const later = await setup.importBookings("max", "tr", [{ date: "2026-09-15", amountCents: -50000, counterparty: "Max Mustermann" }]);
    expect(later.result.linked).toBe(0);
    expect((await setup.transfers.accountOverview(max, "ing"))!.open.map((b) => b.id)).not.toContain(id);
  });

  it("marks a booking as a transfer to another account in the app, which must be visible", async () => {
    const { ing } = await importTestData();
    const id = ing("2026-10-15", -20000);
    expect(await setup.transfers.markWithoutPartner(max, id, { type: "account", accountId: "erika-ing" })).toBe("invalid");
    expect(await setup.transfers.markWithoutPartner(max, id, { type: "account", accountId: "ing" })).toBe("invalid");
    expect(await setup.transfers.markWithoutPartner(max, id, { type: "account", accountId: "tr" })).toBe("ok");
    expect(await setup.transfers.statusOf(max, id)).toMatchObject({ decision: { type: "no-partner", target: "account", accountId: "tr" } });
  });

  it("never links an unlinked pair again", async () => {
    const { ing, tr } = await importTestData();
    const out = ing("2026-10-14", -100000);
    expect(await setup.transfers.unlink(max, out)).toBe(true);
    expect(await setup.transfers.statusOf(max, out)).toMatchObject({ link: null, open: true, isTransfer: true });
    expect(await setup.transfers.statusOf(max, tr("2026-10-15", 100000))).toMatchObject({ link: null, open: true });
    const again = await setup.transfers.matchAfterImport(max, { bookingIds: [out, tr("2026-10-15", 100000)], members: [] });
    expect(again).toEqual({ linked: 0, proposed: 0 });
    expect(await setup.kindOf(out)).toBe("transfer");
  });

  it("keeps a type set by hand and does not match it", async () => {
    const [out] = (await setup.importBookings("max", "ing", [ING_ROWS[5]])).ids;
    expect(await setup.transfers.setKind(max, out, "expense")).toBe(true);
    const tr = await setup.importBookings("max", "tr", [TR_ROWS[0]]);
    expect(tr.result).toEqual({ linked: 0, proposed: 0 });
    expect(await setup.kindOf(out)).toBe("expense");
    expect(await setup.transfers.statusOf(max, out)).toMatchObject({ isTransfer: false, open: false, decision: { type: "kind", kind: "expense" } });
  });

  it("changing a linked booking to income unlinks it; the partner stays an open transfer", async () => {
    const { ing, tr } = await importTestData();
    const into = tr("2026-10-15", 100000);
    expect(await setup.transfers.setKind(max, into, "income")).toBe(true);
    expect(await setup.kindOf(into)).toBe("income");
    expect(await setup.transfers.statusOf(max, ing("2026-10-14", -100000))).toMatchObject({ link: null, open: true });
  });

  it("changes a linked pair to saving on both sides", async () => {
    const { ing, tr } = await importTestData();
    expect(await setup.transfers.setKind(max, ing("2026-10-14", -100000), "saving")).toBe(true);
    expect(await setup.kindOf(ing("2026-10-14", -100000))).toBe("saving");
    expect(await setup.kindOf(tr("2026-10-15", 100000))).toBe("saving");
    expect((await setup.transfers.statusOf(max, tr("2026-10-15", 100000)))!.link).not.toBeNull();
  });

  it("links any two visible opposite bookings by hand, from the candidate list", async () => {
    const { ing } = await importTestData();
    const out = ing("2026-10-15", -20000);
    // Entered by hand on the TR account: no matching ran for it.
    const [into] = (await setup.importBookings("max", "tr", [{ date: "2026-10-25", amountCents: 20000 }], [])).ids;
    const status = (await setup.transfers.statusOf(max, out))!;
    expect(status.candidates.map((c) => c.id)).toContain(into);
    expect(await setup.transfers.link(max, out, into)).toBe("ok");
    expect((await setup.transfers.statusOf(max, into))!.link).toMatchObject({ manual: true, partner: { booking: { id: out } } });
    expect(await setup.kindOf(into)).toBe("transfer");
  });

  it("refuses a manual link of bookings that cannot form a transfer", async () => {
    const { ing } = await importTestData();
    expect(await setup.transfers.link(max, ing("2026-10-15", -20000), ing("2026-09-15", 50000))).toBe("invalid");
    expect(await setup.transfers.link(max, ing("2026-10-15", -20000), ing("2026-10-14", -100000))).toBe("invalid");
  });

  it("a deleted booking dissolves its pair; the partner is open again", async () => {
    const { ing, tr } = await importTestData();
    await setup.deleteBooking(tr("2026-10-15", 100000));
    expect(await setup.transfers.statusOf(max, ing("2026-10-14", -100000))).toMatchObject({ link: null, open: true });
  });
});
