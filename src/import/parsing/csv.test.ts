import { describe, expect, it } from "vitest";
import { splitFields, splitLines } from "./csv";

describe("splitLines", () => {
  it("splits CRLF and LF and keeps line numbers", () => {
    expect(splitLines("a\r\nb\n\nc")).toEqual(["a", "b", "", "c"]);
  });

  it("keeps line breaks inside quotes in one line", () => {
    expect(splitLines('a,"x\ny",b\nc')).toEqual(['a,"x\ny",b', "c"]);
  });
});

describe("splitFields", () => {
  it("splits on the delimiter", () => {
    expect(splitFields("a;b;;c", ";")).toEqual(["a", "b", "", "c"]);
  });

  it("handles quoted fields with delimiters and escaped quotes", () => {
    expect(splitFields('1,"Savings plan, quantity: 1",x', ",")).toEqual(["1", "Savings plan, quantity: 1", "x"]);
    expect(splitFields('"say ""hi""";b', ";")).toEqual(['say "hi"', "b"]);
  });
});
