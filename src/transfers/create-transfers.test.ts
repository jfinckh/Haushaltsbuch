import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Caller } from "@/shared/rls";
import { createTestDatabase, ING_IBAN, ING_ROWS, MEMBERS, TR_ROWS } from "./test-utils";

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

/** Accepts, as `caller`, every proposal of the account they can decide on; returns how many. */
async function acceptAll(caller: Caller, accountId: string) {
  const overview = (await setup.transfers.accountOverview(caller, accountId))!;
  for (const proposal of overview.proposals) {
    expect(await setup.transfers.acceptProposal(caller, proposal.pairId)).toBe("ok");
  }
  return overview.proposals.length;
}

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

  it("asks Max before linking the shared rent to his private booking, then links the same month only", async () => {
    const { ing } = await importTestData();
    const shared = await setup.importBookings("erika", "shared", [
      { date: "2026-09-01", amountCents: 120000, counterparty: "Max Mustermann", reference: "Miete und co" },
      { date: "2026-10-02", amountCents: 120000, counterparty: "Max Mustermann", reference: "Miete und co" },
    ]);
    // Max's side is private: Erika's import only proposes it to Max, and she learns nothing.
    expect(shared.result).toEqual({ linked: 0, proposed: 0 });
    expect(await setup.transfers.accountOverview(erika, "shared")).toMatchObject({ proposals: [] });
    expect(await setup.kindOf(ing("2026-09-01", -120000))).toBe("transfer");
    expect(await acceptAll(max, "ing")).toBe(2);
    const pairs = await setup.pairs();
    expect(pairs).toEqual(
      expect.arrayContaining([
        { out: ing("2026-09-01", -120000), in: shared.ids[0], status: "linked", manual: true },
        { out: ing("2026-10-01", -120000), in: shared.ids[1], status: "linked", manual: true },
      ]),
    );
  });

  it("links the rent at once when Max imports after the shared account's counter-booking", async () => {
    const shared = await setup.importBookings("erika", "shared", [
      { date: "2026-09-01", amountCents: 120000, counterparty: "Max Mustermann", reference: "Miete und co" },
    ]);
    const { ing, results } = await importTestData();
    expect(results[0].linked).toBe(1);
    expect(await setup.pairs()).toEqual(
      expect.arrayContaining([{ out: ing("2026-09-01", -120000), in: shared.ids[0], status: "linked", manual: false }]),
    );
  });
});

describe("what each member sees", () => {
  it("shows the shared side to Erika with only the owner of Max's private side", async () => {
    const { ing } = await importTestData();
    const shared = await setup.importBookings("erika", "shared", [
      { date: "2026-09-01", amountCents: 120000, counterparty: "Max Mustermann", reference: "Miete und co" },
    ]);
    await acceptAll(max, "ing");
    const status = (await setup.transfers.statusOf(erika, shared.ids[0], MEMBERS))!;
    expect(status.link).toEqual({
      pairId: expect.any(String),
      status: "linked",
      manual: true,
      partner: { visible: false, ownerName: "Max Mustermann" },
    });
    expect(status.candidates).toEqual([]);
    const json = JSON.stringify(status);
    expect(json).not.toContain(ing("2026-09-01", -120000));
    expect(json).not.toContain('"ing"');
    expect(json).not.toContain('"max"');

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
    // Max's side is private: only Max sees the proposal.
    expect(result).toEqual({ linked: 0, proposed: 0 });
    expect((await setup.transfers.statusOf(erika, ids[0]))!.proposals).toEqual([]);
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

  it("hides the target account's id once the caller can no longer see that account", async () => {
    const { ing } = await importTestData();
    const id = ing("2026-10-15", -20000);
    expect(await setup.transfers.markWithoutPartner(max, id, { type: "account", accountId: "shared" })).toBe("ok");
    expect(await setup.transfers.statusOf(max, id)).toMatchObject({ decision: { accountId: "shared" } });
    // Erika, who added the shared account, makes it private.
    await setup.db.execute(sql`UPDATE account SET visibility = 'private', household_id = NULL WHERE id = 'shared'`);
    expect(await setup.transfers.statusOf(max, id)).toMatchObject({ decision: { type: "no-partner", target: "account", accountId: null } });
    expect(JSON.stringify(await setup.transfers.statusOf(max, id))).not.toContain('"shared"');
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

describe("rule results", () => {
  const index = (date: string, cents: number) => ING_ROWS.findIndex((row) => row.date === date && row.amountCents === cents);

  it("keeps a booking a rule made income as income, not an open transfer", async () => {
    const erikaRow = index("2026-10-05", 15000);
    const { ids } = await setup.importWithRules("max", "ing", ING_ROWS, (i) =>
      i === erikaRow ? { kind: "income", category: "otherIncome" } : null,
    );
    expect(await setup.kindOf(ids[erikaRow])).toBe("income");
    expect(await setup.classifiedByOf(ids[erikaRow])).toBe("rule");
    const status = await setup.transfers.statusOf(max, ids[erikaRow]);
    expect(status).toMatchObject({ open: false, isTransfer: false, ruleTarget: null });
  });

  it("makes a rule transfer wait for its partner, and links it when the partner arrives", async () => {
    const rent = index("2026-10-01", -120000);
    const { ids } = await setup.importWithRules("max", "ing", ING_ROWS, (i) =>
      ING_ROWS[i].reference === "Miete und co" ? { kind: "transfer" } : null,
    );
    expect(await setup.transfers.statusOf(max, ids[rent])).toMatchObject({ open: true, isTransfer: true });
    await setup.importBookings("erika", "shared", [{ date: "2026-10-02", amountCents: 120000, counterparty: "Max Mustermann" }]);
    expect(await acceptAll(max, "ing")).toBe(1);
    const status = await setup.transfers.statusOf(max, ids[rent]);
    expect(status?.link?.status).toBe("linked");
    expect(status?.open).toBe(false);
  });

  it("does not list a rule's external own account as open, and still links a later counter-booking", async () => {
    const own = index("2026-09-15", 50000);
    const { ids } = await setup.importWithRules("max", "ing", ING_ROWS, (i) =>
      i === own ? { kind: "transfer", target: "external" } : null,
    );
    const status = await setup.transfers.statusOf(max, ids[own]);
    expect(status).toMatchObject({ open: false, overdue: false, isTransfer: true, ruleTarget: "external", decision: null });
    const overview = await setup.transfers.accountOverview(max, "ing");
    expect(overview?.open.map((b) => b.id)).not.toContain(ids[own]);

    await setup.addAccount("extra", "max");
    await setup.importBookings("max", "extra", [{ date: "2026-09-15", amountCents: -50000, counterparty: "Max Mustermann" }]);
    expect((await setup.transfers.statusOf(max, ids[own]))?.link?.status).toBe("linked");
  });

  it("replaces a rule's target with a manual decision", async () => {
    const own = index("2026-09-15", 50000);
    const { ids } = await setup.importWithRules("max", "ing", ING_ROWS, (i) =>
      i === own ? { kind: "transfer", target: "external" } : null,
    );
    await setup.transfers.setKind(max, ids[own], "income");
    expect(await setup.transfers.statusOf(max, ids[own])).toMatchObject({ ruleTarget: null, decision: { type: "kind", kind: "income" } });
    expect(await setup.classifiedByOf(ids[own])).toBe("manual");
  });

});

describe("contribution to shared accounts (dashboard, all own private accounts)", () => {
  const contribution = async (caller: Caller, month = "2026-10") => setup.transfers.sharedContribution(caller, month);

  /** The shared account's counter-bookings of Max's rent, imported by Erika; Max accepts both months. */
  const importRentOnShared = async () => {
    await setup.importBookings("erika", "shared", [
      { date: "2026-09-01", amountCents: 120000, counterparty: "Max Mustermann", reference: "Miete und co" },
      { date: "2026-10-02", amountCents: 120000, counterparty: "Max Mustermann", reference: "Miete und co" },
    ]);
    expect(await acceptAll(max, "ing")).toBe(2);
  };

  it("is zero for transfers between own private accounts and for open transfers", async () => {
    await importTestData();
    expect(await contribution(max)).toEqual({ ok: true, month: "2026-10", cents: 0 });
  });

  it("counts a linked transfer into the shared account, in its own month only", async () => {
    await importTestData();
    await importRentOnShared();
    expect(await contribution(max)).toEqual({ ok: true, month: "2026-10", cents: -120000 });
    expect(await contribution(max, "2026-09")).toEqual({ ok: true, month: "2026-09", cents: -120000 });
    expect(await contribution(max, "2026-08")).toEqual({ ok: true, month: "2026-08", cents: 0 });
  });

  it("is lowered by a transfer from the shared account back to a private account", async () => {
    await importTestData();
    await importRentOnShared();
    const back = await setup.importBookings("erika", "shared", [{ date: "2026-10-20", amountCents: -30000, counterparty: "Max Mustermann" }]);
    const received = await setup.importBookings("max", "ing", [{ date: "2026-10-20", amountCents: 30000, counterparty: "Gemeinschaftskonto" }]);
    expect(await setup.transfers.link(max, received.ids[0], back.ids[0])).toBe("ok");
    expect(await contribution(max)).toMatchObject({ cents: -90000 });
  });

  it("counts a transfer without partner to a shared account, not one to an external own account", async () => {
    const { ing } = await importTestData();
    expect(await setup.transfers.markWithoutPartner(max, ing("2026-10-15", -20000), { type: "account", accountId: "shared" })).toBe("ok");
    expect(await setup.transfers.markWithoutPartner(max, ing("2026-10-05", 15000), { type: "external" })).toBe("ok");
    expect(await contribution(max)).toMatchObject({ cents: -20000 });
  });

  it("counts only the caller's own private bookings, never another member's", async () => {
    await importTestData();
    await importRentOnShared();
    await setup.importBookings("erika", "erika-ing", [{ date: "2026-10-03", amountCents: -50000, counterparty: "Gemeinschaftskonto" }]);
    const fromErika = await setup.importBookings("erika", "shared", [{ date: "2026-10-03", amountCents: 50000, counterparty: "Erika Mustermann" }]);
    expect(fromErika.result.linked).toBe(1);
    expect(await contribution(max)).toMatchObject({ cents: -120000 });
    expect(await contribution(erika)).toMatchObject({ cents: -50000 });
    expect(await contribution(dora)).toEqual({ ok: true, month: "2026-10", cents: 0 });
  });

  it("gives the contribution of a series of months, newest first", async () => {
    await importTestData();
    await importRentOnShared();
    expect(await setup.transfers.sharedContributions(max, "2026-08", "2026-10")).toEqual({
      ok: true,
      months: [
        { month: "2026-10", cents: -120000 },
        { month: "2026-09", cents: -120000 },
        { month: "2026-08", cents: 0 },
      ],
    });
    expect(await setup.transfers.sharedContributions(max, "2025-12", "2026-01")).toEqual({
      ok: true,
      months: [
        { month: "2026-01", cents: 0 },
        { month: "2025-12", cents: 0 },
      ],
    });
  });

  it("never mixes members in a series of months", async () => {
    await importTestData();
    await importRentOnShared();
    await setup.importBookings("erika", "erika-ing", [{ date: "2026-09-03", amountCents: -50000, counterparty: "Gemeinschaftskonto" }]);
    await setup.importBookings("erika", "shared", [{ date: "2026-09-03", amountCents: 50000, counterparty: "Erika Mustermann" }]);
    const series = async (caller: Caller) => {
      const result = await setup.transfers.sharedContributions(caller, "2026-09", "2026-10");
      return result.ok && result.months.map((m) => m.cents);
    };
    expect(await series(max)).toEqual([-120000, -120000]);
    expect(await series(erika)).toEqual([0, -50000]);
    expect(await series(dora)).toEqual([0, 0]);
  });

  it("rejects an invalid series of months", async () => {
    expect(await setup.transfers.sharedContributions(max, "2026-10", "2026-09")).toEqual({ ok: false, reason: "invalid-input" });
    expect(await setup.transfers.sharedContributions(max, "2024-09", "2026-10")).toEqual({ ok: false, reason: "invalid-input" });
    expect(await setup.transfers.sharedContributions(max, "2026-00", "2026-10")).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("rejects an invalid month", async () => {
    expect(await contribution(max, "2026-13")).toEqual({ ok: false, reason: "invalid-input" });
    expect(await contribution(max, "oct")).toEqual({ ok: false, reason: "invalid-input" });
  });
});

describe("another member's private bookings need their owner's OK", () => {
  const OTHER_IBAN = "DE89370400440532013000";

  /** Erika's private salary, which Max may not see. */
  const erikasSalary = async () =>
    (
      await setup.importBookings("erika", "erika-ing", [
        { date: "2026-10-01", amountCents: 312345, counterparty: "Arbeitgeber GmbH", reference: "Gehalt" },
      ])
    ).ids[0];

  /** Max books −3.123,45 € naming Erika, as if he guessed her salary. */
  const maxProbes = async (date = "2026-10-03", amountCents = -312345) =>
    (await setup.importBookings("max", "ing", [{ date, amountCents, counterparty: "Erika Mustermann" }])).ids[0];

  it("tells Max nothing when he guesses the amount of Erika's private booking, and changes nothing of hers", async () => {
    const salary = await erikasSalary();
    const miss = await setup.importBookings("max", "ing", [{ date: "2026-10-03", amountCents: -312300, counterparty: "Erika Mustermann" }]);
    const hit = await setup.importBookings("max", "ing", [{ date: "2026-10-03", amountCents: -312345, counterparty: "Erika Mustermann" }]);
    expect(hit.result).toEqual({ linked: 0, proposed: 0 });
    expect(hit.result).toEqual(miss.result);
    const withoutBooking = async (id: string) => {
      const { booking, ...rest } = (await setup.transfers.statusOf(max, id))!;
      return { ...rest, kind: booking.kind };
    };
    expect(await withoutBooking(hit.ids[0])).toEqual(await withoutBooking(miss.ids[0]));
    expect(await setup.transfers.statusOf(max, hit.ids[0])).toMatchObject({ link: null, proposals: [], open: true });
    expect(await setup.kindOf(salary)).toBe("income");

    await setup.deleteBooking(hit.ids[0]);
    expect(await setup.kindOf(salary)).toBe("income");
    expect(await setup.classifiedByOf(salary)).toBe("auto");
    expect(await setup.transfers.statusOf(erika, salary)).toMatchObject({ link: null, proposals: [], open: false });
  });

  it("lets only Erika accept the proposal for her private booking; then both sides are linked", async () => {
    const salary = await erikasSalary();
    const out = await maxProbes();
    const view = (await setup.transfers.statusOf(erika, salary, MEMBERS))!;
    expect(view.proposals).toHaveLength(1);
    expect(view.proposals[0].partner).toEqual({ visible: false, ownerName: "Max Mustermann" });
    const pairId = view.proposals[0].pairId;
    expect(await setup.transfers.acceptProposal(max, pairId)).toBe("not-found");
    expect(await setup.transfers.rejectProposal(max, pairId)).toBe(false);
    expect(await setup.transfers.acceptProposal(dora, pairId)).toBe("not-found");
    expect(await setup.kindOf(salary)).toBe("income");

    expect(await setup.transfers.acceptProposal(erika, pairId)).toBe("ok");
    expect(await setup.kindOf(salary)).toBe("transfer");
    expect((await setup.transfers.statusOf(max, out, MEMBERS))!.link).toMatchObject({
      status: "linked",
      partner: { visible: false, ownerName: "Erika Mustermann" },
    });
    // Without the household's names (the owner left), only "a member" is known.
    expect((await setup.transfers.statusOf(max, out))!.link?.partner).toEqual({ visible: false, ownerName: null });
  });

  it("never proposes it again after Erika rejects", async () => {
    const salary = await erikasSalary();
    const out = await maxProbes();
    const [proposal] = (await setup.transfers.statusOf(erika, salary))!.proposals;
    expect(await setup.transfers.rejectProposal(erika, proposal.pairId)).toBe(true);
    await setup.transfers.matchAfterImport(max, { bookingIds: [out], members: MEMBERS });
    expect((await setup.transfers.statusOf(erika, salary))!.proposals).toEqual([]);
    expect(await setup.kindOf(salary)).toBe("income");
  });

  it("gives Max the same result whether or not Erika has a matching private booking", async () => {
    const probe = async (withSalary: boolean) => {
      await prepare();
      if (withSalary) await erikasSalary();
      await setup.addAccount("max-savings", "max", { iban: OTHER_IBAN });
      // Same day as Erika's salary, so her booking would tie with Max's own counter-booking.
      await setup.importBookings("max", "max-savings", [{ date: "2026-10-01", amountCents: 312345, counterparty: "Max Mustermann" }]);
      const { ids, result } = await setup.importBookings("max", "ing", [
        { date: "2026-10-01", amountCents: -312345, counterparty: "Erika Mustermann", counterpartyIban: OTHER_IBAN },
      ]);
      const { link } = (await setup.transfers.statusOf(max, ids[0]))!;
      return { result, partnerAccount: link?.partner.visible ? link.partner.booking.accountId : null };
    };
    const without = await probe(false);
    expect(without).toEqual({ result: { linked: 1, proposed: 0 }, partnerAccount: "max-savings" });
    expect(await probe(true)).toEqual(without);
  });

  it("does not make Max's booking a transfer for naming the IBAN of Erika's private account", async () => {
    await setup.addAccount("erika-savings", "erika", { iban: OTHER_IBAN });
    const { ids } = await setup.importBookings("max", "ing", [
      { date: "2026-10-03", amountCents: -5000, counterparty: "Laden", counterpartyIban: OTHER_IBAN },
    ]);
    expect(await setup.kindOf(ids[0])).toBe("expense");

    await setup.addAccount("max-savings", "max", { iban: "DE75512108001245126199" });
    const own = await setup.importBookings("max", "ing", [
      { date: "2026-10-03", amountCents: -6000, counterparty: "Laden", counterpartyIban: "DE75512108001245126199" },
    ]);
    expect(await setup.kindOf(own.ids[0])).toBe("transfer");
  });

  it("changes the type of a linked pair only on the side the caller may see", async () => {
    const salary = await erikasSalary();
    const out = await maxProbes();
    const [proposal] = (await setup.transfers.statusOf(erika, salary))!.proposals;
    expect(await setup.transfers.acceptProposal(erika, proposal.pairId)).toBe("ok");
    expect(await setup.transfers.setKind(max, out, "saving")).toBe(true);
    expect(await setup.kindOf(out)).toBe("saving");
    expect(await setup.kindOf(salary)).toBe("transfer");
  });
});
