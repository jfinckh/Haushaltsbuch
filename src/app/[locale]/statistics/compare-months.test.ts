import { describe, expect, it } from "vitest";
import { chosenCompare, compareParams, shownMonths, statisticsHref } from "./compare-months";

describe("chosenCompare", () => {
  const current = "2026-10";

  it("is empty without a value", () => {
    expect(chosenCompare(undefined, "2026-10", current)).toEqual([]);
    expect(chosenCompare("", "2026-10", current)).toEqual([]);
  });

  it("keeps valid months, newest first", () => {
    expect(chosenCompare("2025-10,2026-09", "2026-10", current)).toEqual(["2026-09", "2025-10"]);
  });

  it("drops malformed, future, too early, duplicate and main months", () => {
    expect(chosenCompare("2026-13,2026-11,1969-12,abc,2026-10,2026-09,2026-09", "2026-10", current)).toEqual(["2026-09"]);
  });

  it("keeps at most two months", () => {
    expect(chosenCompare("2026-09,2026-08,2026-07", "2026-10", current)).toEqual(["2026-09", "2026-08"]);
  });
});

describe("shownMonths", () => {
  it("puts the main and compared months newest first", () => {
    expect(shownMonths("2026-08", ["2026-09", "2025-08"])).toEqual(["2026-09", "2026-08", "2025-08"]);
    expect(shownMonths("2026-08", [])).toEqual(["2026-08"]);
  });
});

describe("statisticsHref", () => {
  it("links account and month, and the compared months when there are any", () => {
    expect(statisticsHref({ account: "all", month: "2026-10", compare: [] })).toBe("/statistics?account=all&month=2026-10");
    expect(statisticsHref({ account: "a1", month: "2026-10", compare: ["2026-09", "2025-10"] })).toBe(
      "/statistics?account=a1&month=2026-10&compare=2026-09,2025-10",
    );
  });

  it("leaves out a compared month that becomes the main month", () => {
    expect(statisticsHref({ account: "a1", month: "2026-09", compare: ["2026-09", "2025-10"] })).toBe(
      "/statistics?account=a1&month=2026-09&compare=2025-10",
    );
  });
});

describe("compareParams", () => {
  it("is empty without compared months", () => {
    expect(compareParams([])).toEqual({});
    expect(compareParams(["2026-09"])).toEqual({ compare: "2026-09" });
  });
});
