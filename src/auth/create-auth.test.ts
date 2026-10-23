import { beforeEach, describe, expect, it } from "vitest";
import { findInviter, findUserNames, hasUserWithEmail } from "./create-auth";
import { createBrowser, createTestAuth, tokenFromUrl } from "./test-utils";

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

describe("hasUserWithEmail", () => {
  it("tells whether a user with the email exists, ignoring case", async () => {
    await signUp("Max Muster", "max@example.com");
    expect(await hasUserWithEmail(setup.auth, "max@example.com")).toBe(true);
    expect(await hasUserWithEmail(setup.auth, "Max@Example.com")).toBe(true);
    expect(await hasUserWithEmail(setup.auth, "erika@example.com")).toBe(false);
  });
});

describe("findInviter", () => {
  it("returns null for a user without an inviter", async () => {
    const max = await signUp("Max Muster", "max@example.com");
    expect(await findInviter(setup.auth, max)).toBeNull();
  });

  it("returns the current inviter and when their invite was accepted", async () => {
    const max = createBrowser(setup.auth);
    const maxId = (await max.signUp("Max Muster", "max@example.com")).json.user.id;
    const invite = await max.createInvite();
    const erika = createBrowser(setup.auth);
    const erikaId = (await erika.signUp("Erika Test", "erika@example.com")).json.user.id;
    await erika.acceptInvite(tokenFromUrl(invite.json.url));

    const inviter = await findInviter(setup.auth, erikaId);
    expect(inviter).toEqual({ id: maxId, name: "Max Muster", invitedAt: expect.any(Date) });
  });
});
