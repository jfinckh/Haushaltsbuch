import { describe, expect, it } from "vitest";
import { describeMembers } from "./member-names";

const names = new Map([
  ["max", "Max Muster"],
  ["erika", "Erika Test"],
  ["lena", "Lena Beispiel"],
]);

describe("describeMembers", () => {
  it("says when the user is alone", () => {
    expect(describeMembers("max", ["max"], names)).toBe("Only you so far");
  });

  it("names the other members", () => {
    expect(describeMembers("max", ["max", "erika"], names)).toBe("You and Erika Test");
    expect(describeMembers("erika", ["max", "erika", "lena"], names)).toBe("You, Max Muster and Lena Beispiel");
  });

  it("falls back when a name is missing", () => {
    expect(describeMembers("max", ["max", "ghost"], names)).toBe("You and a member");
  });
});
