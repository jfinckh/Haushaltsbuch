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

  it("opening a link only shows who invites; the new user joins by accepting, which uses up the link", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const ben = createBrowser(setup.auth);

    const opened = await ben.openInvite(tokenFromUrl(anna.url));
    expect(opened.json).toEqual({ valid: true, inviterName: "Anna", signedIn: false, own: false });
    expect(ben.hasCookie("invite_token")).toBe(false);

    await ben.signUp("Ben", "ben@example.com");
    expect((await ben.getInviter()).json).toEqual({ inviter: null });
    const [unused] = await setup.db.select().from(authInvite);
    expect(unused.usedAt).toBeNull();

    expect((await ben.acceptInvite(tokenFromUrl(anna.url))).json).toEqual({ applied: true });
    expect((await ben.getInviter()).json).toEqual({ inviter: { id: anna.userId, name: "Anna" } });

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
    expect((await ben.acceptInvite(tokenFromUrl(anna.url))).json).toEqual({ applied: false });
    expect((await ben.acceptInvite("does-not-exist")).json).toEqual({ applied: false });
    expect((await ben.getInviter()).json).toEqual({ inviter: null });
  });

  it("signing in after opening a link records nothing", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const ben = createBrowser(setup.auth);
    const benId = (await ben.signUp("Ben", "ben@example.com")).json.user.id;
    await ben.signOut();

    await ben.openInvite(tokenFromUrl(anna.url));
    await ben.signIn("ben@example.com");
    expect((await userRow(benId)).invitedById).toBeNull();
  });

  it("a signed-in user opening a link gets the inviter only by accepting", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const ben = createBrowser(setup.auth);
    await ben.signUp("Ben", "ben@example.com");
    const opened = await ben.openInvite(tokenFromUrl(anna.url));
    expect(opened.json).toEqual({ valid: true, inviterName: "Anna", signedIn: true, own: false });
    expect((await ben.getInviter()).json).toEqual({ inviter: null });
    expect((await ben.acceptInvite(tokenFromUrl(anna.url))).json).toEqual({ applied: true });
    expect((await ben.getInviter()).json.inviter.name).toBe("Anna");
  });

  it("accepting needs a session", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const anonymous = createBrowser(setup.auth);
    expect((await anonymous.acceptInvite(tokenFromUrl(anna.url))).status).toBe(401);
    const [invite] = await setup.db.select().from(authInvite);
    expect(invite.usedAt).toBeNull();
  });

  it("a new invite from someone else replaces the recorded inviter", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const ben = createBrowser(setup.auth);
    const benId = (await ben.signUp("Ben", "ben@example.com")).json.user.id;
    await ben.acceptInvite(tokenFromUrl(anna.url));
    const first = await userRow(benId);

    const carla = await inviteFrom("Carla", "carla@example.com");
    expect((await ben.acceptInvite(tokenFromUrl(carla.url))).json).toEqual({ applied: true });
    expect((await ben.getInviter()).json.inviter).toEqual({ id: carla.userId, name: "Carla" });
    const second = await userRow(benId);
    expect(second.invitedAt!.getTime()).toBeGreaterThan(first.invitedAt!.getTime());

    const [carlaInvite] = await setup.db.select().from(authInvite).where(eq(authInvite.inviterId, carla.userId));
    expect(carlaInvite.usedById).toBe(benId);
  });

  it("an already used invite can't be accepted again, also not by the person who used it", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const ben = createBrowser(setup.auth);
    await ben.signUp("Ben", "ben@example.com");
    expect((await ben.acceptInvite(tokenFromUrl(anna.url))).json.applied).toBe(true);

    expect((await ben.openInvite(tokenFromUrl(anna.url))).json).toEqual({ valid: false });
    expect((await ben.acceptInvite(tokenFromUrl(anna.url))).json).toEqual({ applied: false });
    const dora = createBrowser(setup.auth);
    await dora.signUp("Dora", "dora@example.com");
    expect((await dora.openInvite(tokenFromUrl(anna.url))).json).toEqual({ valid: false });
    expect((await dora.acceptInvite(tokenFromUrl(anna.url))).json).toEqual({ applied: false });
    expect((await dora.getInviter()).json).toEqual({ inviter: null });
  });

  it("an own invite is never accepted, also with another inviter on record", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    const ben = createBrowser(setup.auth);
    await ben.signUp("Ben", "ben@example.com");
    await ben.acceptInvite(tokenFromUrl(anna.url));

    const own = await ben.createInvite();
    const opened = await ben.openInvite(tokenFromUrl(own.json.url));
    expect(opened.json).toEqual({ valid: true, inviterName: "Ben", signedIn: true, own: true });
    expect((await ben.acceptInvite(tokenFromUrl(own.json.url))).json).toEqual({ applied: false });
    expect((await ben.getInviter()).json.inviter.name).toBe("Anna");
  });

  it("ignores self-invites", async () => {
    const anna = await inviteFrom("Anna", "anna@example.com");
    expect((await anna.browser.openInvite(tokenFromUrl(anna.url))).json.own).toBe(true);
    expect((await anna.browser.acceptInvite(tokenFromUrl(anna.url))).json).toEqual({ applied: false });
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
    const benId = (await ben.signUp("Ben", "ben@example.com")).json.user.id;
    await ben.acceptInvite(tokenFromUrl(anna.url));

    const dora = createBrowser(setup.auth);
    await dora.signUp("Dora", "dora@example.com");
    const res = await dora.request(`/invite/inviter?userId=${benId}`);
    expect(res.json).toEqual({ inviter: null });
  });
});
