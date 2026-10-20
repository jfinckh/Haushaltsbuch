import { describe, expect, it } from "vitest";
import { signInSchema, signUpSchema } from "./validation";

describe("signUpSchema", () => {
  it("accepts valid input and trims the name", () => {
    const result = signUpSchema.parse({ name: "  Max ", email: "max@example.com", password: "geheim123" });
    expect(result.name).toBe("Max");
  });

  it("rejects short passwords, bad emails and empty names", () => {
    expect(signUpSchema.safeParse({ name: "Max", email: "max@example.com", password: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({ name: "Max", email: "no-email", password: "geheim123" }).success).toBe(false);
    expect(signUpSchema.safeParse({ name: "  ", email: "max@example.com", password: "geheim123" }).success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("requires email and password", () => {
    expect(signInSchema.safeParse({ email: "max@example.com", password: "x" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "max@example.com", password: "" }).success).toBe(false);
  });
});
