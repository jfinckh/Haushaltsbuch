import { describe, expect, it } from "vitest";
import { repeatSchema, templateActionSchema } from "./validation";

describe("repeatSchema", () => {
  it("accepts every 12 months without end", () => {
    expect(repeatSchema.safeParse({ intervalMonths: 12, endDate: null }).success).toBe(true);
  });

  it("rejects an interval of 2 months", () => {
    expect(repeatSchema.safeParse({ intervalMonths: 2, endDate: null }).success).toBe(false);
  });

  it("rejects an end date that is no date", () => {
    expect(repeatSchema.safeParse({ intervalMonths: 1, endDate: "2026-13-01" }).success).toBe(false);
  });
});

describe("templateActionSchema", () => {
  it("rejects an unknown action", () => {
    expect(templateActionSchema.safeParse({ action: "stop" }).success).toBe(false);
  });

  it("accepts resume", () => {
    expect(templateActionSchema.safeParse({ action: "resume" }).success).toBe(true);
  });
});
