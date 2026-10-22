import { describe, expect, it } from "vitest";
import { offersAllMine, selectAccount } from "./select-account";

const giro = { id: "giro", archived: false, visibility: "private" as const };
const shared = { id: "shared", archived: false, visibility: "shared" as const };
const old = { id: "old", archived: true, visibility: "private" as const };
const tr = { id: "tr", archived: false, visibility: "private" as const };

/** One private active account: no combined view. */
const accounts = [old, giro, shared];
/** Two private active accounts: the combined view comes first. */
const withTwoPrivate = [old, giro, shared, tr];

describe("selectAccount", () => {
  it("picks the active account named in the address", () => {
    expect(selectAccount(accounts, "shared")).toBe(shared);
    expect(selectAccount(withTwoPrivate, "tr")).toBe(tr);
  });

  it("falls back to the first active account for a missing, unknown or archived id", () => {
    expect(selectAccount(accounts, undefined)).toBe(giro);
    expect(selectAccount(accounts, "someone-elses-private")).toBe(giro);
    expect(selectAccount(accounts, "old")).toBe(giro);
  });

  it("gives null without active accounts", () => {
    expect(selectAccount([old], "old")).toBeNull();
    expect(selectAccount([], undefined)).toBeNull();
  });

  it("picks 'all' when named, and as the default with two or more active private accounts", () => {
    expect(selectAccount(withTwoPrivate, "all")).toBe("all");
    expect(selectAccount(withTwoPrivate, undefined)).toBe("all");
    expect(selectAccount(withTwoPrivate, "someone-elses-private")).toBe("all");
    expect(selectAccount(withTwoPrivate, "old")).toBe("all");
  });

  it("never picks 'all' with fewer than two active private accounts", () => {
    expect(selectAccount(accounts, "all")).toBe(giro);
    expect(selectAccount([shared], "all")).toBe(shared);
  });
});

describe("offersAllMine", () => {
  it("needs two or more active private accounts; shared and archived ones do not count", () => {
    expect(offersAllMine(withTwoPrivate)).toBe(true);
    expect(offersAllMine(accounts)).toBe(false);
    expect(offersAllMine([giro, { ...tr, archived: true }])).toBe(false);
    expect(offersAllMine([giro, { ...shared, id: "shared-2" }, shared])).toBe(false);
  });
});
