import { describe, expect, it } from "vitest";
import { repeatSchema, templateActionSchema, templateInputSchema } from "./validation";

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

describe("templateInputSchema", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({
    accountId: "shared",
    amount: "-1.200,00",
    kind: "expense",
    category: "housing.rent",
    counterparty: "Vermieter GmbH",
    counterpartyIban: "",
    reference: "",
    countsNextMonth: null,
    intervalMonths: 1,
    nextDueDate: "2026-11-28",
    endDate: null,
    ...overrides,
  });
  const issues = (overrides: Record<string, unknown>) => {
    const result = templateInputSchema.safeParse(input(overrides));
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };

  it("parses the German amount into cents and empty texts into null", () => {
    const result = templateInputSchema.parse(input());
    expect(result).toMatchObject({ amountCents: -120000, counterpartyIban: null, reference: null, counterparty: "Vermieter GmbH" });
  });

  it("rejects an amount of zero", () => {
    expect(issues({ amount: "0" })).toContain("recurring.validation.amountInvalid");
  });

  it("rejects a category for a transfer", () => {
    expect(issues({ kind: "transfer" })).toContain("recurring.validation.categoryNotForKind");
  });

  it("rejects an end before the next date", () => {
    expect(issues({ endDate: "2026-11-01" })).toContain("recurring.validation.endBeforeNext");
  });

  it("rejects an invalid IBAN", () => {
    expect(issues({ counterpartyIban: "DE00 1234" })).toContain("recurring.validation.ibanInvalid");
  });

  it("normalizes a valid IBAN", () => {
    expect(templateInputSchema.parse(input({ counterpartyIban: "de89 3704 0044 0532 0130 00" })).counterpartyIban).toBe("DE89370400440532013000");
  });
});
