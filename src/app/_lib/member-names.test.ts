import { describe, expect, it } from "vitest";
import { describeMembers } from "./member-names";

const names = new Map([
  ["max", "Max Muster"],
  ["erika", "Erika Test"],
  ["lena", "Lena Beispiel"],
]);

const english = { you: "You", onlyYou: "Only you so far", aMember: "a member" };
const german = { you: "Du", onlyYou: "Bisher nur du", aMember: "ein Mitglied" };
const listIn = (locale: string) => (items: string[]) =>
  new Intl.ListFormat(locale, { type: "conjunction" }).format(items);

describe("describeMembers", () => {
  it("says when the user is alone", () => {
    expect(describeMembers("max", ["max"], names, english, listIn("en"))).toBe("Only you so far");
    expect(describeMembers("max", ["max"], names, german, listIn("de"))).toBe("Bisher nur du");
  });

  it("names the other members", () => {
    expect(describeMembers("max", ["max", "erika"], names, english, listIn("en"))).toBe("You and Erika Test");
    expect(describeMembers("erika", ["max", "erika", "lena"], names, german, listIn("de"))).toBe(
      "Du, Max Muster und Lena Beispiel",
    );
  });

  it("falls back when a name is missing", () => {
    expect(describeMembers("max", ["max", "ghost"], names, english, listIn("en"))).toBe("You and a member");
  });
});
