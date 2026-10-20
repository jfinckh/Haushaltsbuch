import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { authInvite, authUser } from "../schema";
import { createBrowser, createTestAuth, TEST_BASE_URL, tokenFromUrl } from "../test-utils";

type Setup = Awaited<ReturnType<typeof createTestAuth>>;

let setup: Setup;

beforeEach(async () => {
  setup = await createTestAuth();
});

async function inviteFrom(name: string, email: string) {
  const browser = createBrowser(setup.auth);
  const signUp = await browser.signUp(name, email);
  const created = await browser.createInvite();
  expect(created.status).toBe(200);
  return { browser, userId: signUp.json.user.id as string, url: created.json.url as string };
}

async function userRow(id: string) {
  const [row] = await setup.db.select().from(authUser).where(eq(authUser.id, id));
  return row;
}

describe("invite links", () => {
  it("open sign-up works without an invite; inviter is null", async () => {
    const browser = createBrowser(setup.auth);
    const res = await browser.signUp("Max", "max@example.com");
    expect(res.status).toBe(200);
    expect((await browser.getInviter()).json).toEqual({ inviter: null });
  });

  it("rejects sign-up input that breaks the shared rules", async () => {
    const browser = createBrowser(setup.auth);
    const res = await browser.signUp("  ", "max@example.com");
    expect(res.status).toBe(400);
  });

  it("creating an invite needs a session and returns a link on the invite page", async () => {
    const anonymous = createBrowser(setup.auth);
    expect((await anonymous.createInvite()).status).toBe(401);

    const { url } = await inviteFrom("Anna", "anna@example.com");
    expect(url.startsWith(`${TEST_BASE_URL}/invite/`)).toBe(true);
    const [row] = await setup.db.select().from(authInvite);
    expect(row.tokenHash).not.toBe(tokenFromUrl(url)); // only the hash is stored
  });

  it("signing up after opening a link records the inviter and uses up the link", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const ben = createBrowser(setup.auth);

    const opened = await ben.openInvite(tokenFromUrl(anna.url));
    expect(opened.json).toEqual({ valid: true, inviterName: "Anna", applied: false, signedIn: false });

    await ben.signUp("Ben", "ben@example.com");
    expect((await ben.getInviter()).json).toEqual({ inviter: { id: anna.userId, name: "Anna" } });
    expect(ben.hasCookie("invite_token")).toBe(false);

    const [invite] = await setup.db.select().from(authInvite);
    expect(invite.usedAt).not.toBeNull();

    // Single use: a second person can't use the same link.
    const carla = createBrowser(setup.auth);
    expect((await carla.openInvite(tokenFromUrl(anna.url))).json).toEqual({ valid: false });
  });

  it("unknown and expired tokens are invalid and record nothing", async () => {
    setup = await createTestAuth({ inviteTtlSeconds: -1 });
    const anna = await inviteFrom("Anna", "anna@example.com");
    const ben = createBrowser(setup.auth);
    expect((await ben.openInvite(tokenFromUrl(anna.url))).json).toEqual({ valid: false });
    expect((await ben.openInvite("does-not-exist")).json).toEqual({ valid: false });
    await ben.signUp("Ben", "ben@example.com");
    expect((await ben.getInviter()).json).toEqual({ inviter: null });
  });

  it("an existing user signing in through a link gets the inviter if none is set", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const ben = createBrowser(setup.auth);
    const benId = (await ben.signUp("Ben", "ben@example.com")).json.user.id;
    await ben.signOut();

    await ben.openInvite(tokenFromUrl(anna.url));
    await ben.signIn("ben@example.com");
    expect((await userRow(benId)).invitedById).toBe(anna.userId);
  });

  it("a signed-in user opening a link gets the inviter immediately", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const ben = createBrowser(setup.auth);
    await ben.signUp("Ben", "ben@example.com");
    const opened = await ben.openInvite(tokenFromUrl(anna.url));
    expect(opened.json).toEqual({ valid: true, inviterName: "Anna", applied: true, signedIn: true });
    expect((await ben.getInviter()).json.inviter.name).toBe("Anna");
  });

  it("never overwrites an existing inviter and leaves the second link unused", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const ben = createBrowser(setup.auth);
    await ben.openInvite(tokenFromUrl(anna.url));
    await ben.signUp("Ben", "ben@example.com");

    const carla = await inviteFrom("Carla", "carla@example.com");
    const opened = await ben.openInvite(tokenFromUrl(carla.url));
    expect(opened.json.applied).toBe(false);
    expect((await ben.getInviter()).json.inviter.name).toBe("Anna");

    const [carlaInvite] = await setup.db.select().from(authInvite).where(eq(authInvite.inviterId, carla.userId));
    expect(carlaInvite.usedAt).toBeNull();
  });

  it("ignores self-invites", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const opened = await anna.browser.openInvite(tokenFromUrl(anna.url));
    expect(opened.json.applied).toBe(false);
    expect((await anna.browser.getInviter()).json).toEqual({ inviter: null });
  });
});

describe("privacy of the inviter endpoint", () => {
  it("needs a session", async () => {
    const anonymous = createBrowser(setup.auth);
    expect((await anonymous.getInviter()).status).toBe(401);
  });

  it("returns only the caller's own inviter and ignores any user id in the query", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const ben = createBrowser(setup.auth);
    await ben.openInvite(tokenFromUrl(anna.url));
    const benId = (await ben.signUp("Ben", "ben@example.com")).json.user.id;

    const dora = createBrowser(setup.auth);
    await dora.signUp("Dora", "dora@example.com");
    const res = await dora.request(`/invite/inviter?userId=${benId}`);
    expect(res.json).toEqual({ inviter: null });
  });
});
