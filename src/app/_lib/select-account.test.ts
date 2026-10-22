import { describe, expect, it } from "vitest";
import { selectAccount } from "./select-account";

const accounts = [
  { id: "old", archived: true },
  { id: "giro", archived: false },
  { id: "shared", archived: false },
];

describe("selectAccount", () => {
  it("picks the active account named in the address", () => {
    expect(selectAccount(accounts, "shared")?.id).toBe("shared");
  });

  it("falls back to the first active account for a missing, unknown or archived id", () => {
    expect(selectAccount(accounts, undefined)?.id).toBe("giro");
    expect(selectAccount(accounts, "someone-elses-private")?.id).toBe("giro");
    expect(selectAccount(accounts, "old")?.id).toBe("giro");
  });

  it("gives null without active accounts", () => {
    expect(selectAccount([{ id: "old", archived: true }], "old")).toBeNull();
    expect(selectAccount([], undefined)).toBeNull();
  });
});
