import { beforeEach, describe, expect, it } from "vitest";
import { findUserNames } from "./create-auth";
import { createBrowser, createTestAuth } from "./test-utils";

type Setup = Awaited<ReturnType<typeof createTestAuth>>;

let setup: Setup;

beforeEach(async () => {
  setup = await createTestAuth();
});

async function signUp(name: string, email: string): Promise<string> {
  const res = await createBrowser(setup.auth).signUp(name, email);
  return res.json.user.id;
}

describe("findUserNames", () => {
  it("returns names for the given ids only", async () => {
    const max = await signUp("Max Muster", "max@example.com");
    const erika = await signUp("Erika Test", "erika@example.com");
    await signUp("Dora Other", "dora@example.com");

    const names = await findUserNames(setup.auth, [max, erika, max, "unknown"]);
    expect(Object.fromEntries(names)).toEqual({ [max]: "Max Muster", [erika]: "Erika Test" });
  });

  it("returns nothing for no ids", async () => {
    await signUp("Max Muster", "max@example.com");
    expect((await findUserNames(setup.auth, [])).size).toBe(0);
  });
});
