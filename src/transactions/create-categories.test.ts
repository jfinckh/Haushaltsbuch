import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withSession, type Caller } from "@/shared/rls";
import { CATEGORY_GROUPS } from "./categories";
import { createCategories } from "./create-categories";
import { createTestDatabase } from "./test-utils";

// Own categories of a household (every member) and of one person (only them), hidden standard keys,
// and privacy: personal rows exist only for their owner, household rows only for the household's
// members (service and row-level security).

type Setup = Awaited<ReturnType<typeof createTestDatabase>>;

let setup: Setup;
let categories: ReturnType<typeof createCategories>;
let max: Caller;
let erika: Caller;
let dora: Caller;
let solo: Caller;

beforeEach(async () => {
  setup = await createTestDatabase();
  categories = createCategories({ db: setup.db });
  await setup.householdOf("home", "max", "erika");
  await setup.householdOf("other", "dora");
  [max, erika, dora, solo] = await Promise.all([setup.as("max"), setup.as("erika"), setup.as("dora"), setup.as("solo")]);
});

async function create(caller: Caller, input: Record<string, unknown>) {
  const result = await categories.createCategory(caller, { scope: "household", kind: "expense", ...input });
  if (!result.ok) throw new Error(`create failed: ${result.reason}`);
  return result.category;
}

describe("creating categories", () => {
  it("adds a household group and a personal group, each listed in its own scope", async () => {
    const pets = await create(max, { name: " Haustiere " });
    const hobby = await create(max, { scope: "personal", name: "Modellbau" });
    expect(pets).toEqual({ id: pets.id, key: `c_${pets.id}`, scope: "household", kind: "expense", parentKey: null, name: "Haustiere", archived: false });
    expect(hobby).toMatchObject({ key: `c_${hobby.id}`, scope: "personal", name: "Modellbau" });

    const listed = await categories.listCategories(max);
    expect(listed.household?.categories).toEqual([pets]);
    expect(listed.personal.categories).toEqual([hobby]);
    expect(listed.household?.hidden).toEqual([]);
  });

  it("adds subcategories under a standard group and under an own group", async () => {
    const bakery = await create(max, { parentKey: "groceries", name: "Bäcker" });
    expect(bakery).toMatchObject({ key: `groceries.c_${bakery.id}`, parentKey: "groceries" });
    const pets = await create(max, { name: "Haustiere" });
    const vet = await create(max, { parentKey: pets.key, name: "Tierarzt" });
    expect(vet).toMatchObject({ key: `${pets.key}.c_${vet.id}`, parentKey: pets.key });
    const bonus = await create(max, { kind: "income", parentKey: "salary", name: "Bonus" });
    expect(bonus.key).toBe(`salary.c_${bonus.id}`);
  });

  it("rejects a parent that does not exist, does not fit the type, is a subcategory, archived or of the other scope", async () => {
    const pets = await create(max, { name: "Haustiere" });
    const vet = await create(max, { parentKey: pets.key, name: "Tierarzt" });
    const mine = await create(max, { scope: "personal", name: "Modellbau" });
    const invalid = { ok: false, reason: "invalid-input" };
    for (const parentKey of ["unknown", "salary", "groceries.supermarket", vet.key, mine.key, "c_missing"]) {
      expect(await categories.createCategory(max, { scope: "household", kind: "expense", parentKey, name: "X" })).toEqual(invalid);
    }
    expect(await categories.setArchived(max, pets.id, true)).toMatchObject({ ok: true });
    expect(await categories.createCategory(max, { scope: "household", kind: "expense", parentKey: pets.key, name: "Futter" })).toEqual(invalid);
  });

  it("rejects an empty or too long name and unknown scopes or types", async () => {
    const invalid = { ok: false, reason: "invalid-input" };
    expect(await categories.createCategory(max, { scope: "household", kind: "expense", name: "  " })).toEqual(invalid);
    expect(await categories.createCategory(max, { scope: "household", kind: "expense", name: "x".repeat(41) })).toEqual(invalid);
    expect(await categories.createCategory(max, { scope: "everyone", kind: "expense", name: "X" })).toEqual(invalid);
    expect(await categories.createCategory(max, { scope: "household", kind: "transfer", name: "X" })).toEqual(invalid);
    expect(await categories.createCategory(max, null)).toEqual(invalid);
  });

  it("allows a name only once per parent and scope, ignoring case; archived ones do not count", async () => {
    const pets = await create(max, { name: "Haustiere" });
    expect(await categories.createCategory(erika, { scope: "household", kind: "expense", name: "haustiere" })).toEqual({ ok: false, reason: "duplicate" });
    expect(await categories.createCategory(max, { scope: "personal", kind: "expense", name: "Haustiere" })).toMatchObject({ ok: true });
    expect(await categories.createCategory(max, { scope: "household", kind: "expense", parentKey: "groceries", name: "Haustiere" })).toMatchObject({ ok: true });
    await categories.setArchived(max, pets.id, true);
    expect(await categories.createCategory(max, { scope: "household", kind: "expense", name: "Haustiere" })).toMatchObject({ ok: true });
  });

  it("needs a household for the household scope; personal categories work without one", async () => {
    expect(await categories.createCategory(solo, { scope: "household", kind: "expense", name: "X" })).toEqual({ ok: false, reason: "not-found" });
    expect(await categories.createCategory(solo, { scope: "personal", kind: "expense", name: "X" })).toMatchObject({ ok: true });
    expect((await categories.listCategories(solo)).household).toBeNull();
  });
});

describe("renaming and archiving", () => {
  it("renames an own category, also by another household member", async () => {
    const pets = await create(max, { name: "Haustiere" });
    expect(await categories.renameCategory(erika, pets.id, { name: "Tiere" })).toEqual({ ok: true, category: { ...pets, name: "Tiere" } });
  });

  it("rejects a rename to an existing name under the same parent", async () => {
    await create(max, { name: "Haustiere" });
    const garden = await create(max, { name: "Garten" });
    expect(await categories.renameCategory(max, garden.id, { name: "HAUSTIERE" })).toEqual({ ok: false, reason: "duplicate" });
    expect(await categories.renameCategory(max, garden.id, { name: "garten" })).toMatchObject({ ok: true, category: { name: "garten" } });
    expect(await categories.renameCategory(max, garden.id, { name: "" })).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("archives and restores, and keeps archived ones in the list", async () => {
    const pets = await create(max, { name: "Haustiere" });
    expect(await categories.setArchived(max, pets.id, true)).toEqual({ ok: true, category: { ...pets, archived: true } });
    expect((await categories.listCategories(max)).household?.categories).toEqual([{ ...pets, archived: true }]);
    expect(await categories.setArchived(max, pets.id, false)).toEqual({ ok: true, category: pets });
  });

  it("does not restore a category when an active one has its name", async () => {
    const pets = await create(max, { name: "Haustiere" });
    await categories.setArchived(max, pets.id, true);
    await create(max, { name: "Haustiere" });
    expect(await categories.setArchived(max, pets.id, false)).toEqual({ ok: false, reason: "duplicate" });
  });
});

describe("hiding standard categories", () => {
  it("hides and shows standard groups and subcategories per scope", async () => {
    expect(await categories.setHidden(max, { scope: "household", key: "children", hidden: true })).toEqual({ ok: true });
    expect(await categories.setHidden(max, { scope: "household", key: "children", hidden: true })).toEqual({ ok: true });
    expect(await categories.setHidden(max, { scope: "personal", key: "groceries.drugstore", hidden: true })).toEqual({ ok: true });
    expect(await categories.setHidden(max, { scope: "personal", key: "childBenefit", hidden: true })).toEqual({ ok: true });
    let listed = await categories.listCategories(max);
    expect(listed.household?.hidden).toEqual(["children"]);
    expect(listed.personal.hidden).toEqual(["childBenefit", "groceries.drugstore"]);
    expect((await categories.listCategories(erika)).household?.hidden).toEqual(["children"]);

    expect(await categories.setHidden(erika, { scope: "household", key: "children", hidden: false })).toEqual({ ok: true });
    listed = await categories.listCategories(max);
    expect(listed.household?.hidden).toEqual([]);
  });

  it("only hides standard keys", async () => {
    const pets = await create(max, { name: "Haustiere" });
    for (const key of [pets.key, "unknown", "groceries.unknown"]) {
      expect(await categories.setHidden(max, { scope: "household", key, hidden: true })).toEqual({ ok: false, reason: "invalid-input" });
    }
    expect(await categories.setHidden(solo, { scope: "household", key: "children", hidden: true })).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("privacy", () => {
  it("never shows another member's personal categories or hidden keys, as if they did not exist", async () => {
    const hobby = await create(max, { scope: "personal", name: "Modellbau" });
    await categories.setHidden(max, { scope: "personal", key: "children", hidden: true });
    const ofErika = await categories.listCategories(erika);
    expect(ofErika.personal).toEqual({ hidden: [], categories: [] });
    expect(ofErika.household).toEqual({ hidden: [], categories: [] });
    expect(await categories.renameCategory(erika, hobby.id, { name: "X" })).toEqual({ ok: false, reason: "not-found" });
    expect(await categories.setArchived(erika, hobby.id, true)).toEqual({ ok: false, reason: "not-found" });
    expect(await categories.createCategory(erika, { scope: "personal", kind: "expense", parentKey: hobby.key, name: "X" })).toEqual({
      ok: false,
      reason: "invalid-input",
    });
    // Unchanged for Max.
    expect((await categories.listCategories(max)).personal).toEqual({ hidden: ["children"], categories: [hobby] });
  });

  it("never shows a household's categories to another household", async () => {
    const pets = await create(max, { name: "Haustiere" });
    await categories.setHidden(max, { scope: "household", key: "children", hidden: true });
    expect(await categories.listCategories(dora)).toEqual({ household: { hidden: [], categories: [] }, personal: { hidden: [], categories: [] } });
    expect(await categories.renameCategory(dora, pets.id, { name: "X" })).toEqual({ ok: false, reason: "not-found" });
    expect(await categories.setArchived(dora, pets.id, true)).toEqual({ ok: false, reason: "not-found" });
    expect(await categories.setHidden(dora, { scope: "household", key: "children", hidden: false })).toEqual({ ok: true });
    expect((await categories.listCategories(max)).household?.hidden).toEqual(["children"]);
  });

  it("row-level security returns and accepts only the caller's own rows", async () => {
    await create(max, { scope: "personal", name: "Modellbau" });
    await create(max, { name: "Haustiere" });
    const visible = (caller: Caller) =>
      withSession(setup.db, caller, async (tx) => {
        const result = (await tx.execute(sql`SELECT name FROM category ORDER BY name`)) as unknown as { rows: { name: string }[] };
        return result.rows.map((row) => row.name);
      });
    expect(await visible(max)).toEqual(["Haustiere", "Modellbau"]);
    expect(await visible(erika)).toEqual(["Haustiere"]);
    expect(await visible(dora)).toEqual([]);
    // Dora cannot write into another household or as another person.
    await expect(
      withSession(setup.db, dora, (tx) =>
        tx.execute(sql`INSERT INTO category (id, household_id, kind, name, created_by_user_id) VALUES ('x', 'home', 'expense', 'X', 'dora')`),
      ),
    ).rejects.toThrow();
    await expect(
      withSession(setup.db, dora, (tx) =>
        tx.execute(sql`INSERT INTO hidden_category (id, owner_user_id, key, created_by_user_id) VALUES ('x', 'max', 'children', 'dora')`),
      ),
    ).rejects.toThrow();
  });
});

describe("catalog", () => {
  const keysOf = (groups: { key: string; subcategories: { key: string }[] }[], group: string) =>
    groups.find((g) => g.key === group)?.subcategories.map((s) => s.key);

  it("offers standard and household categories on shared accounts, plus personal ones on private accounts", async () => {
    const bakery = await create(max, { parentKey: "groceries", name: "Bäcker" });
    const pets = await create(max, { name: "Haustiere" });
    const vet = await create(max, { parentKey: pets.key, name: "Tierarzt" });
    const hobby = await create(max, { scope: "personal", name: "Modellbau" });
    const bonus = await create(max, { scope: "personal", kind: "income", parentKey: "salary", name: "Bonus" });

    const catalog = await categories.catalog(max);
    expect(catalog.names).toEqual({ [bakery.key]: "Bäcker", [pets.key]: "Haustiere", [vet.key]: "Tierarzt", [hobby.key]: "Modellbau", [bonus.key]: "Bonus" });

    expect(keysOf(catalog.shared, "groceries")).toEqual(["groceries.supermarket", "groceries.drugstore", bakery.key]);
    expect(catalog.shared.find((g) => g.key === pets.key)).toEqual({ key: pets.key, kind: "expense", name: "Haustiere", subcategories: [{ key: vet.key, name: "Tierarzt" }] });
    expect(catalog.shared.some((g) => g.key === hobby.key)).toBe(false);
    expect(keysOf(catalog.shared, "salary")).toEqual([]);

    expect(catalog.private.some((g) => g.key === hobby.key)).toBe(true);
    expect(keysOf(catalog.private, "salary")).toEqual([bonus.key]);
    // Own groups follow the standard groups of their type.
    const kinds = catalog.private.map((g) => g.kind);
    expect(kinds.indexOf("income")).toBeGreaterThan(catalog.private.findIndex((g) => g.key === pets.key));
  });

  it("leaves out hidden standard categories and archived own ones, but keeps their names", async () => {
    const pets = await create(max, { name: "Haustiere" });
    await categories.setArchived(max, pets.id, true);
    await categories.setHidden(max, { scope: "household", key: "children", hidden: true });
    await categories.setHidden(max, { scope: "personal", key: "groceries.drugstore", hidden: true });
    const catalog = await categories.catalog(max);
    expect(catalog.names[pets.key]).toBe("Haustiere");
    for (const choices of [catalog.shared, catalog.private]) {
      expect(choices.some((g) => g.key === pets.key || g.key === "children")).toBe(false);
    }
    expect(keysOf(catalog.shared, "groceries")).toEqual(["groceries.supermarket", "groceries.drugstore"]);
    expect(keysOf(catalog.private, "groceries")).toEqual(["groceries.supermarket"]);
  });

  it("never contains another member's personal categories or another household's", async () => {
    const hobby = await create(max, { scope: "personal", name: "Modellbau" });
    await categories.setHidden(max, { scope: "personal", key: "children", hidden: true });
    const pets = await create(max, { name: "Haustiere" });
    const ofErika = await categories.catalog(erika);
    expect(ofErika.names).toEqual({ [pets.key]: "Haustiere" });
    expect(JSON.stringify(ofErika)).not.toContain(hobby.id);
    expect(ofErika.private.some((g) => g.key === "children")).toBe(true);
    const ofDora = await categories.catalog(dora);
    expect(ofDora.names).toEqual({});
    expect(ofDora.shared.map((g) => g.key)).toEqual(CATEGORY_GROUPS.map((g) => g.key));
  });
});
