import { describe, expect, it } from "vitest";
import { messages } from "./messages";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

describe("messages", () => {
  it("has the same keys in German and English", () => {
    expect(keys(messages.de).sort()).toEqual(keys(messages.en).sort());
  });

  it("has no empty texts", () => {
    for (const locale of ["de", "en"] as const) {
      const empty = keys(messages[locale]).filter((key) => {
        const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages[locale]);
        return typeof text !== "string" || text.trim() === "";
      });
      expect(empty, locale).toEqual([]);
    }
  });
});
