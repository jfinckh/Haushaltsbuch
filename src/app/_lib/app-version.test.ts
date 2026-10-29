import { describe, expect, it } from "vitest";
import { formatAppVersion } from "./app-version";

describe("formatAppVersion", () => {
  it("shows the short commit and the build time in German time", () => {
    expect(formatAppVersion("4d4fd9d0123456789abcdef0123456789abcdef0", "2026-10-28T22:15:00Z")).toBe("4d4fd9d · 28.10.2026, 23:15");
    // Summer time: UTC+2
    expect(formatAppVersion("4d4fd9d0123456789abcdef0123456789abcdef0", "2026-07-01T08:05:00Z")).toBe("4d4fd9d · 01.07.2026, 10:05");
  });

  it("shows just the version without a valid build time", () => {
    expect(formatAppVersion("dev", "")).toBe("dev");
    expect(formatAppVersion("dev", "not a date")).toBe("dev");
  });
});
