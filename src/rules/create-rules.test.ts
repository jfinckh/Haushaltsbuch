import { beforeEach, describe, expect, it } from "vitest";
import type { Caller } from "@/shared/rls";
import { createTestDatabase, ING_ROWS } from "./test-utils";
import type { RuleInput } from "./validation";

type Setup = Awaited<ReturnType<typeof createTestDatabase>>;

let setup: Setup;
let max: Caller;
let erika: Caller;
let dora: Caller;

const rule = (overrides: Partial<RuleInput> = {}): RuleInput => ({
  scope: { type: "account", accountId: "max-ing" },
  counterparty: "REWE",
  reference: null,
  amountSign: null,
  kind: "expense",
  category: "groceries.supermarket",
  transferTarget: null,
  ...overrides,
});

async function create(caller: Caller, overrides: Partial<RuleInput> = {}) {
  const result = await setup.rules.createRule(caller, rule(overrides));
  if (!result.ok) throw new Error(`create failed: ${result.reason}`);
  return result.rule;
}

/** Imports the ING rows into Max's account; returns their ids by counterparty/reference start. */
async function importIng(userId = "max", accountId = "max-ing") {
  const ids = await setup.importBookings(userId, accountId, ING_ROWS);
  return (date: string) => ids[ING_ROWS.findIndex((row) => row.date === date)];
}

beforeEach(async () => {
  setup = await createTestDatabase();
  await setup.householdOf("home", "max", "erika");
  await setup.householdOf("other", "dora");
  await setup.addAccount("max-ing", "max");
  await setup.addAccount("shared", "max", "home");
  await setup.addAccount("erika-ing", "erika");
  await setup.addAccount("dora-ing", "dora");
  [max, erika, dora] = await Promise.all([setup.as("max"), setup.as("erika"), setup.as("dora")]);
});

describe("managing rules", () => {
  it("creates, lists, changes and deletes a rule", async () => {
    const created = await create(max);
    expect(created).toMatchObject({
      scope: { type: "account", accountId: "max-ing" },
      counterparty: "REWE",
      kind: "expense",
      category: "groceries.supermarket",
      createdByMe: true,
    });
    const changed = await setup.rules.updateRule(max, created.id, rule({ counterparty: "rewe  markt", amountSign: "negative" }));
    expect(changed.ok && changed.rule).toMatchObject({ counterparty: "rewe markt", amountSign: "negative" });
    expect((await setup.rules.listRules(max)).map((r) => r.id)).toEqual([created.id]);
    expect(await setup.rules.deleteRule(max, created.id)).toBe(true);
    expect(await setup.rules.listRules(max)).toEqual([]);
  });

  it("stores the patterns encrypted", async () => {
    await create(max, { counterparty: "Erika Mustermann", reference: "Anteil Urlaub", kind: "income", category: null });
    expect(JSON.stringify(await setup.ruleRows())).not.toMatch(/Erika|Urlaub/);
  });

  it("rejects invalid rules", async () => {
    for (const input of [
      rule({ counterparty: "", reference: " " }),
      rule({ kind: "transfer", category: "groceries" }),
      rule({ kind: "expense", category: "salary" }),
      rule({ kind: "expense", transferTarget: "external" }),
      rule({ counterparty: "x".repeat(201) }),
    ]) {
      expect(await setup.rules.createRule(max, input)).toEqual({ ok: false, reason: "invalid-input" });
    }
  });

  it("creates rules for all shared accounts and for all my private accounts", async () => {
    const shared = await create(max, { scope: { type: "shared" } });
    const own = await create(max, { scope: { type: "private" } });
    expect(shared.scope).toEqual({ type: "shared" });
    expect(own.scope).toEqual({ type: "private" });
  });

  it("refuses a shared rule without household", async () => {
    await setup.addAccount("solo-ing", "solo");
    const solo = await setup.as("solo");
    expect(await setup.rules.createRule(solo, rule({ scope: { type: "shared" } }))).toEqual({ ok: false, reason: "no-household" });
  });
});

describe("what each member sees and changes (privacy)", () => {
  it("shows Erika shared rules, but never Max's private ones or those of his private account", async () => {
    const onShared = await create(max, { scope: { type: "account", accountId: "shared" } });
    const householdWide = await create(max, { scope: { type: "shared" } });
    const onPrivate = await create(max);
    const ownWide = await create(max, { scope: { type: "private" } });
    const visible = (await setup.rules.listRules(erika)).map((r) => r.id).sort();
    expect(visible).toEqual([onShared.id, householdWide.id].sort());
    expect(await setup.rules.getRule(erika, onPrivate.id)).toBeNull();
    expect(await setup.rules.getRule(erika, ownWide.id)).toBeNull();
    expect(await setup.rules.listRules(dora)).toEqual([]);
    expect((await setup.rules.listRules(erika)).every((r) => !r.createdByMe)).toBe(true);
  });

  it("lets Erika change and delete shared rules, never Max's private ones", async () => {
    const onShared = await create(max, { scope: { type: "account", accountId: "shared" } });
    const onPrivate = await create(max);
    const ownWide = await create(max, { scope: { type: "private" } });
    const changed = await setup.rules.updateRule(erika, onShared.id, rule({ scope: { type: "account", accountId: "shared" }, counterparty: "EDEKA" }));
    expect(changed.ok).toBe(true);
    for (const id of [onPrivate.id, ownWide.id]) {
      expect(await setup.rules.updateRule(erika, id, rule({ scope: { type: "account", accountId: "erika-ing" } }))).toEqual({
        ok: false,
        reason: "not-found",
      });
      expect(await setup.rules.deleteRule(erika, id)).toBe(false);
    }
    expect((await setup.rules.getRule(max, onPrivate.id))?.counterparty).toBe("REWE");
    expect(await setup.rules.getRule(max, ownWide.id)).not.toBeNull();
  });

  it("never creates a rule on another member's private account, as if it did not exist", async () => {
    expect(await setup.rules.createRule(erika, rule())).toEqual({ ok: false, reason: "not-found" });
    expect(await setup.rules.createRule(dora, rule({ scope: { type: "account", accountId: "shared" } }))).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("never moves a rule onto an account the caller cannot see", async () => {
    const onShared = await create(erika, { scope: { type: "account", accountId: "shared" } });
    expect(await setup.rules.updateRule(erika, onShared.id, rule())).toEqual({ ok: false, reason: "not-found" });
  });

  it("hides a shared account's rules from Erika once Max makes the account private", async () => {
    await create(max, { scope: { type: "account", accountId: "shared" } });
    await setup.makePrivate("shared");
    expect(await setup.rules.listRules(erika)).toEqual([]);
    expect(await setup.rules.listRules(max)).toHaveLength(1);
  });
});

describe("applying rules to new bookings", () => {
  it("sorts the REWE and Spotify bookings of the ING file", async () => {
    await create(max);
    await create(max, { counterparty: null, reference: "spotify", category: "contracts.subscriptions" });
    const id = await importIng();
    const ids = ING_ROWS.map((row) => id(row.date));
    const result = await setup.rules.applyToBookings(max, ids);
    expect(result).toEqual({ applied: 3, transfers: [] });
    expect(await setup.stored(id("2026-10-07"))).toEqual({ kind: "expense", category: "groceries.supermarket", classifiedBy: "rule" });
    expect(await setup.stored(id("2026-09-03"))).toMatchObject({ category: "groceries.supermarket" });
    expect(await setup.stored(id("2026-09-04"))).toMatchObject({ category: "contracts.subscriptions" });
    expect(await setup.stored(id("2026-10-05"))).toEqual({ kind: "income", category: null, classifiedBy: "auto" });
  });

  it("reports the bookings that became transfers, with their target", async () => {
    await create(max, { counterparty: null, reference: "Miete und co", kind: "transfer", category: null });
    await create(max, { counterparty: "Max Mustermann", amountSign: "positive", kind: "transfer", category: null, transferTarget: "external" });
    const id = await importIng();
    const result = await setup.rules.applyToBookings(max, ING_ROWS.map((row) => id(row.date)));
    expect(result.applied).toBe(2);
    expect(result.transfers).toEqual(
      expect.arrayContaining([
        { id: id("2026-10-01"), target: null },
        { id: id("2026-09-15"), target: "external" },
      ]),
    );
  });

  it("lets the account rule win over a household-wide one", async () => {
    await create(max, { scope: { type: "private" }, category: "groceries" });
    await create(max, { category: "groceries.supermarket" });
    const id = await importIng();
    await setup.rules.applyToBookings(max, [id("2026-10-07")]);
    expect(await setup.stored(id("2026-10-07"))).toMatchObject({ category: "groceries.supermarket" });
  });

  it("never runs Max's private rules on the shared account, even when he imports it", async () => {
    await create(max, { scope: { type: "private" } });
    const id = await importIng("max", "shared");
    expect(await setup.rules.applyToBookings(max, [id("2026-10-07")])).toEqual({ applied: 0, transfers: [] });
    await create(max, { scope: { type: "shared" } });
    expect((await setup.rules.applyToBookings(max, [id("2026-10-07")])).applied).toBe(1);
  });

  it("runs shared rules when Erika imports the shared account, but never Max's private rules", async () => {
    await create(max, { scope: { type: "private" }, category: "groceries" });
    await create(max, { scope: { type: "account", accountId: "shared" }, category: "groceries.supermarket" });
    const id = await importIng("erika", "shared");
    await setup.rules.applyToBookings(erika, [id("2026-10-07")]);
    expect(await setup.stored(id("2026-10-07"))).toMatchObject({ category: "groceries.supermarket" });
  });

  it("never touches bookings the caller may not see", async () => {
    await create(erika, { scope: { type: "private" } });
    const id = await importIng();
    expect(await setup.rules.applyToBookings(erika, [id("2026-10-07")])).toEqual({ applied: 0, transfers: [] });
    expect(await setup.stored(id("2026-10-07"))).toMatchObject({ classifiedBy: "auto", category: null });
  });

  it("never overwrites a category set by hand", async () => {
    await create(max);
    const id = await importIng();
    await setup.transactions.updateTransaction(max, id("2026-10-07"), { category: "shopping.household" });
    expect((await setup.rules.applyToBookings(max, [id("2026-10-07")])).applied).toBe(0);
    expect(await setup.stored(id("2026-10-07"))).toMatchObject({ category: "shopping.household", classifiedBy: "manual" });
  });
});

describe("applying rules to an account's existing bookings", () => {
  it("sorts only uncategorized expenses and income, never manual ones", async () => {
    const id = await importIng();
    await setup.transactions.updateTransaction(max, id("2026-09-03"), { category: "shopping" });
    await create(max);
    const result = await setup.rules.applyToAccount(max, "max-ing");
    expect(result).toEqual({ ok: true, applied: 1, transfers: [] });
    expect(await setup.stored(id("2026-10-07"))).toMatchObject({ category: "groceries.supermarket" });
    expect(await setup.stored(id("2026-09-03"))).toMatchObject({ category: "shopping" });
  });

  it("treats another member's private account like an unknown one", async () => {
    await importIng();
    await create(erika, { scope: { type: "private" } });
    expect(await setup.rules.applyToAccount(erika, "max-ing")).toEqual({ ok: false, reason: "not-found" });
    expect(await setup.rules.applyToAccount(erika, "nope")).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("learning from a correction", () => {
  it("creates an account rule with the booking's type and category", async () => {
    const id = await importIng();
    await setup.transactions.updateTransaction(max, id("2026-09-04"), { category: "contracts.subscriptions" });
    const result = await setup.rules.createFromBooking(max, id("2026-09-04"), { field: "reference", pattern: " Spotify " });
    expect(result.ok && result.rule).toMatchObject({
      scope: { type: "account", accountId: "max-ing" },
      counterparty: null,
      reference: "Spotify",
      kind: "expense",
      category: "contracts.subscriptions",
      transferTarget: null,
    });
  });

  it("takes an external own account as the target of a transfer", async () => {
    const id = await importIng();
    await setup.transactions.updateTransaction(max, id("2026-09-15"), { kind: "transfer" });
    const result = await setup.rules.createFromBooking(max, id("2026-09-15"), { field: "counterparty", pattern: "Max Mustermann" }, "external");
    expect(result.ok && result.rule).toMatchObject({ kind: "transfer", category: null, transferTarget: "external", amountSign: "positive" });
    // The rent to the shared account also names Max, but goes the other way.
    const rent = await setup.importBookings("max", "max-ing", [ING_ROWS[2]]);
    expect((await setup.rules.applyToBookings(max, rent)).applied).toBe(0);
  });

  it("keeps no sign for expenses and income, so refunds are sorted too", async () => {
    const id = await importIng();
    await setup.transactions.updateTransaction(max, id("2026-10-07"), { category: "groceries" });
    const result = await setup.rules.createFromBooking(max, id("2026-10-07"), { field: "counterparty", pattern: "REWE" });
    expect(result.ok && result.rule.amountSign).toBeNull();
  });

  it("rejects a pattern that is not in the booking", async () => {
    const id = await importIng();
    expect(await setup.rules.createFromBooking(max, id("2026-09-04"), { field: "counterparty", pattern: "Spotify" })).toEqual({
      ok: false,
      reason: "invalid-input",
    });
  });

  it("treats another member's private booking like an unknown one", async () => {
    const id = await importIng();
    expect(await setup.rules.createFromBooking(erika, id("2026-10-07"), { field: "counterparty", pattern: "REWE" })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await setup.rules.listRules(max)).toEqual([]);
  });
});
