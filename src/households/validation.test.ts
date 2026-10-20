import { describe, expect, it } from "vitest";
import { createHouseholdSchema } from "./validation";

describe("createHouseholdSchema", () => {
  it("trims the name", () => {
    expect(createHouseholdSchema.parse({ name: "  Mustermann  " })).toEqual({ name: "Mustermann" });
  });

  it("rejects empty and overlong names", () => {
    expect(createHouseholdSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createHouseholdSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
    expect(createHouseholdSchema.safeParse({}).success).toBe(false);
  });
});
