import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { InvalidSessionError } from "@/shared/rls";
import { account } from "./schema";
import { createTestAccounts, IBAN } from "./test-utils";

type Setup = Awaited<ReturnType<typeof createTestAccounts>>;

let setup: Setup;

beforeEach(async () => {
  setup = await createTestAccounts();
  await setup.householdOf("home", "max", "erika");
  await setup.householdOf("other", "dora");
});

const giro = { name: "ING Giro", bank: "ing", type: "checking", visibility: "private", openingBalance: "1.234,56" };
const joint = { name: "Gemeinschaftskonto", bank: "ing", type: "checking", visibility: "shared", openingBalance: "0" };

async function create(userId: string, input: unknown) {
  const result = await setup.accounts.createAccount(await setup.as(userId), input);
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.accounts[0];
}

describe("creating accounts", () => {
  it("creates a private account owned by the caller", async () => {
    const result = await setup.accounts.createAccount(await setup.as("max"), { ...giro, iban: "de89 3704 0044 0532 0130 00" });
    expect(result).toEqual({
      ok: true,
      accounts: [
        {
          id: expect.any(String),
          name: "ING Giro",
          bank: "ing",
          type: "checking",
          role: "everyday",
          visibility: "private",
          openingBalanceCents: 123456,
          iban: "DE89 3704 0044 0532 0130 00",
          archived: false,
          ownedByMe: true,
        },
      ],
    });
    const [row] = await setup.db.select().from(account);
    expect(row).toMatchObject({ ownerUserId: "max", householdId: null });
  });

  it("puts a shared account into the caller's household", async () => {
    await create("max", joint);
    const [row] = await setup.db.select().from(account);
    expect(row).toMatchObject({ visibility: "shared", householdId: "home", ownerUserId: "max" });
  });

  it("refuses a shared account without a household, but allows a private one", async () => {
    expect(await setup.accounts.createAccount(await setup.as("lone"), joint)).toEqual({ ok: false, reason: "no-household" });
    expect((await setup.accounts.createAccount(await setup.as("lone"), giro)).ok).toBe(true);
  });

  it("derives the role from the type unless given", async () => {
    expect((await create("max", { ...giro, type: "savings" })).role).toBe("savings");
    expect((await create("max", { ...giro, type: "depot", role: "everyday" })).role).toBe("everyday");
  });

  it("accepts negative opening balances", async () => {
    expect((await create("max", { ...giro, openingBalance: "-50,5" })).openingBalanceCents).toBe(-5050);
  });

  it("creates cash without an IBAN", async () => {
    const cash = await create("max", { name: "Bargeld", bank: "cash", type: "cash", visibility: "private", openingBalance: "20" });
    expect(cash).toMatchObject({ type: "cash", role: "everyday", iban: null });
  });

  it.each([
    ["an empty name", { ...giro, name: " " }],
    ["a float amount", { ...giro, openingBalance: "12.5" }],
    ["a number amount", { ...giro, openingBalance: 12 }],
    ["an invalid IBAN", { ...giro, iban: "DE00 1234" }],
    ["a type the bank has not", { ...giro, type: "clearing" }],
    ["cash with an IBAN", { name: "Bar", bank: "cash", type: "cash", visibility: "private", openingBalance: "0", iban: IBAN }],
    ["an unknown bank", { ...giro, bank: "sparkasse" }],
    ["no input", null],
  ])("rejects %s", async (_label, input) => {
    expect(await setup.accounts.createAccount(await setup.as("max"), input)).toEqual({ ok: false, reason: "invalid-input" });
    expect(await setup.db.select().from(account)).toEqual([]);
  });

  it("ignores an owner or household in the input", async () => {
    await create("max", { ...joint, ownerUserId: "dora", householdId: "other" });
    const [row] = await setup.db.select().from(account);
    expect(row).toMatchObject({ ownerUserId: "max", householdId: "home" });
  });

  it("creates Trade Republic as clearing account and depot", async () => {
    const result = await setup.accounts.createAccount(await setup.as("max"), {
      setup: "trade-republic",
      visibility: "private",
      iban: IBAN,
      clearingOpeningBalance: "100,00",
      depotOpeningBalance: "2.500",
    });
    expect(result.ok && result.accounts).toEqual([
      expect.objectContaining({ name: "Trade Republic", type: "clearing", role: "everyday", openingBalanceCents: 10000, iban: "DE89 3704 0044 0532 0130 00" }),
      expect.objectContaining({ name: "Trade Republic Depot", type: "depot", role: "savings", openingBalanceCents: 250000, iban: null }),
    ]);
  });
});

describe("encryption", () => {
  it("stores the IBAN only encrypted, with a blind index", async () => {
    await create("max", { ...giro, iban: IBAN });
    const [row] = await setup.db.select().from(account);
    expect(row.ibanEncrypted).toMatch(/^1:/);
    expect(JSON.stringify(row)).not.toContain(IBAN);
    expect(row.ibanIndex).toBe(setup.crypto.blindIndex(IBAN, "account.iban"));
  });

  it("finds the same blind index however the IBAN was typed", async () => {
    await create("max", { ...giro, iban: IBAN });
    await create("max", { ...giro, iban: "de89 3704 0044 0532 0130 00" });
    const rows = await setup.db.select().from(account);
    expect(rows[0].ibanIndex).toBe(rows[1].ibanIndex);
  });
});

describe("privacy", () => {
  let privateId: string;
  let sharedId: string;

  beforeEach(async () => {
    privateId = (await create("max", { ...giro, iban: IBAN })).id;
    sharedId = (await create("max", joint)).id;
  });

  it("lists own private accounts and the household's shared accounts only", async () => {
    expect((await setup.accounts.listAccounts(await setup.as("max"))).map((a) => a.name).sort()).toEqual([
      "Gemeinschaftskonto",
      "ING Giro",
    ]);
    expect(await setup.accounts.listAccounts(await setup.as("erika"))).toEqual([
      expect.objectContaining({ id: sharedId, ownedByMe: false }),
    ]);
    expect(await setup.accounts.listAccounts(await setup.as("dora"))).toEqual([]);
  });

  it("hides another member's private account by id, like an unknown id", async () => {
    const erika = await setup.as("erika");
    expect(await setup.accounts.getAccount(erika, privateId)).toBeNull();
    expect(await setup.accounts.getAccount(erika, "unknown")).toBeNull();
    expect(await setup.accounts.updateAccount(erika, privateId, { name: "Mine now" })).toEqual({ ok: false, reason: "not-found" });
    expect(await setup.accounts.updateAccount(erika, "unknown", { name: "x" })).toEqual({ ok: false, reason: "not-found" });
    expect(await setup.accounts.updateAccount(erika, privateId, { visibility: "shared" })).toEqual({ ok: false, reason: "not-found" });
    expect(await setup.accounts.deleteAccount(erika, privateId)).toBe(false);

    const max = await setup.as("max");
    expect(await setup.accounts.getAccount(max, privateId)).toMatchObject({ name: "ING Giro", openingBalanceCents: 123456 });
  });

  it("hides everything from another household", async () => {
    const dora = await setup.as("dora");
    expect(await setup.accounts.getAccount(dora, sharedId)).toBeNull();
    expect(await setup.accounts.updateAccount(dora, sharedId, { name: "x" })).toEqual({ ok: false, reason: "not-found" });
    expect(await setup.accounts.deleteAccount(dora, sharedId)).toBe(false);
    expect(await setup.db.select().from(account)).toHaveLength(2);
  });

  it("lets every member change a shared account, but only the owner its visibility", async () => {
    const erika = await setup.as("erika");
    expect(await setup.accounts.updateAccount(erika, sharedId, { name: "Haushalt" })).toMatchObject({
      ok: true,
      account: { name: "Haushalt" },
    });
    expect(await setup.accounts.updateAccount(erika, sharedId, { visibility: "private" })).toEqual({
      ok: false,
      reason: "not-owner",
    });
    expect(await setup.accounts.getAccount(erika, sharedId)).toMatchObject({ visibility: "shared" });
  });

  it("moves an account between private and shared for its owner", async () => {
    const max = await setup.as("max");
    const erika = await setup.as("erika");
    await setup.accounts.updateAccount(max, privateId, { visibility: "shared" });
    expect(await setup.accounts.getAccount(erika, privateId)).toMatchObject({ visibility: "shared", iban: "DE89 3704 0044 0532 0130 00" });
    await setup.accounts.updateAccount(max, privateId, { visibility: "private" });
    expect(await setup.accounts.getAccount(erika, privateId)).toBeNull();
    const [row] = await setup.db.select().from(account).where(eq(account.id, privateId));
    expect(row.householdId).toBeNull();
  });

  it("refuses callers without a valid session", async () => {
    const forged = { sessionToken: "forged" };
    await expect(setup.accounts.listAccounts(forged)).rejects.toBeInstanceOf(InvalidSessionError);
    await expect(setup.accounts.createAccount(forged, giro)).rejects.toBeInstanceOf(InvalidSessionError);
  });
});

describe("editing", () => {
  it("changes fields, IBAN and opening balance, and checks the result", async () => {
    const max = await setup.as("max");
    const { id } = await create("max", giro);
    expect(await setup.accounts.updateAccount(max, id, { openingBalance: "-1,00", iban: IBAN, role: "savings" })).toMatchObject({
      ok: true,
      account: { openingBalanceCents: -100, iban: "DE89 3704 0044 0532 0130 00", role: "savings" },
    });
    expect(await setup.accounts.updateAccount(max, id, { iban: "" })).toMatchObject({ ok: true, account: { iban: null } });
    expect(await setup.accounts.updateAccount(max, id, { bank: "trade_republic" })).toEqual({ ok: false, reason: "invalid-input" });
    expect(await setup.accounts.updateAccount(max, id, { openingBalance: "1.5" })).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("keeps the stored IBAN when not changed", async () => {
    const max = await setup.as("max");
    const { id } = await create("max", { ...giro, iban: IBAN });
    const [before] = await setup.db.select().from(account);
    await setup.accounts.updateAccount(max, id, { name: "Giro" });
    const [after] = await setup.db.select().from(account);
    expect(after.ibanEncrypted).toBe(before.ibanEncrypted);
  });

  it("archives and unarchives", async () => {
    const max = await setup.as("max");
    const { id } = await create("max", giro);
    expect(await setup.accounts.updateAccount(max, id, { archived: true })).toMatchObject({ account: { archived: true } });
    expect(await setup.accounts.listAccounts(max)).toEqual([expect.objectContaining({ id, archived: true })]);
    expect(await setup.accounts.updateAccount(max, id, { archived: false })).toMatchObject({ account: { archived: false } });
  });

  it("deletes", async () => {
    const max = await setup.as("max");
    const { id } = await create("max", giro);
    expect(await setup.accounts.deleteAccount(max, id)).toBe(true);
    expect(await setup.accounts.listAccounts(max)).toEqual([]);
  });
});

describe("leaving and deleting households", () => {
  it("keeps private accounts with their owner after leaving; shared ones stay with the household", async () => {
    await create("max", giro);
    await create("max", joint);
    await setup.leaveHousehold("max");
    expect((await setup.accounts.listAccounts(await setup.as("max"))).map((a) => a.name)).toEqual(["ING Giro"]);
    expect((await setup.accounts.listAccounts(await setup.as("erika"))).map((a) => a.name)).toEqual(["Gemeinschaftskonto"]);
  });

  it("deletes shared accounts with their household", async () => {
    await create("max", giro);
    await create("max", joint);
    await setup.deleteHousehold("home");
    expect((await setup.db.select().from(account)).map((a) => a.name)).toEqual(["ING Giro"]);
  });

  it("tells households whether a household holds shared accounts", async () => {
    await create("max", giro);
    expect(await setup.db.transaction((tx) => setup.accounts.householdHasSharedAccounts(tx, "home"))).toBe(false);
    await create("max", joint);
    expect(await setup.db.transaction((tx) => setup.accounts.householdHasSharedAccounts(tx, "home"))).toBe(true);
  });
});
