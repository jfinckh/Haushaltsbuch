import { describe, expect, it } from "vitest";
import { createTransactionSchema, listQuerySchema, transactionValuesSchema, updateTransactionSchema } from "./validation";

const valid = {
  accountId: "acc-1",
  date: "2026-10-08",
  amount: "-3,50",
  kind: "expense",
  category: "groceries.supermarket",
  counterparty: "  Bäckerei Müller ",
  counterpartyIban: "de89 3704 0044 0532 0130 00",
  reference: "Brötchen",
};

const issues = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe("createTransactionSchema", () => {
  it("turns the form input into stored values", () => {
    expect(createTransactionSchema.parse(valid)).toEqual({
      accountId: "acc-1",
      bookingDate: "2026-10-08",
      amountCents: -350,
      kind: "expense",
      category: "groceries.supermarket",
      counterparty: "Bäckerei Müller",
      counterpartyIban: "DE89370400440532013000",
      reference: "Brötchen",
    });
  });

  it("treats empty optional fields as missing", () => {
    const parsed = createTransactionSchema.parse({ ...valid, category: "", counterparty: " ", counterpartyIban: "", reference: "" });
    expect(parsed).toMatchObject({ category: null, counterparty: null, counterpartyIban: null, reference: null });
  });

  it("accepts a positive expense (a refund)", () => {
    expect(createTransactionSchema.parse({ ...valid, amount: "120,00", category: "health" }).amountCents).toBe(12000);
  });

  it("rejects a zero amount and malformed amounts", () => {
    expect(issues(createTransactionSchema.safeParse({ ...valid, amount: "0,00" }))).toContain("transactions.validation.amountZero");
    expect(issues(createTransactionSchema.safeParse({ ...valid, amount: "12.5" }))).toContain("shared.validation.amountInvalid");
  });

  it("rejects dates that are not real calendar dates", () => {
    for (const date of ["2026-02-30", "08.10.2026", "", "2026-13-01"]) {
      expect(issues(createTransactionSchema.safeParse({ ...valid, date })), date).toContain("transactions.validation.dateInvalid");
    }
  });

  it("requires a category that fits the type", () => {
    expect(issues(createTransactionSchema.safeParse({ ...valid, kind: "income" }))).toContain(
      "transactions.validation.categoryNotForKind",
    );
    expect(issues(createTransactionSchema.safeParse({ ...valid, kind: "transfer" }))).toContain(
      "transactions.validation.categoryNotForKind",
    );
    expect(createTransactionSchema.parse({ ...valid, kind: "saving", category: "" }).category).toBeNull();
  });

  it("rejects invalid IBANs and overlong texts", () => {
    expect(issues(createTransactionSchema.safeParse({ ...valid, counterpartyIban: "DE00123" }))).toContain(
      "transactions.validation.ibanInvalid",
    );
    expect(issues(createTransactionSchema.safeParse({ ...valid, counterparty: "x".repeat(201) }))).toContain(
      "transactions.validation.counterpartyTooLong",
    );
    expect(issues(createTransactionSchema.safeParse({ ...valid, reference: "x".repeat(501) }))).toContain(
      "transactions.validation.referenceTooLong",
    );
  });

  it("requires an account", () => {
    expect(issues(createTransactionSchema.safeParse({ ...valid, accountId: "" }))).toContain(
      "transactions.validation.accountRequired",
    );
  });
});

describe("updateTransactionSchema", () => {
  it("parses only the given fields", () => {
    expect(updateTransactionSchema.parse({ amount: "-4,20" })).toEqual({ amountCents: -420 });
    expect(updateTransactionSchema.parse({ category: "", reference: "" })).toEqual({ category: null, reference: null });
  });

  it("rejects invalid fields", () => {
    expect(updateTransactionSchema.safeParse({ date: "2026-02-30" }).success).toBe(false);
    expect(updateTransactionSchema.safeParse({ kind: "gift" }).success).toBe(false);
  });
});

describe("transactionValuesSchema", () => {
  it("checks a whole booking after an update", () => {
    const values = createTransactionSchema.parse(valid);
    expect(transactionValuesSchema.safeParse(values).success).toBe(true);
    expect(transactionValuesSchema.safeParse({ ...values, kind: "income" }).success).toBe(false);
    expect(transactionValuesSchema.safeParse({ ...values, amountCents: 0 }).success).toBe(false);
  });
});

describe("listQuerySchema", () => {
  it("needs an account and accepts optional filters", () => {
    expect(listQuerySchema.parse({ accountId: "acc-1" })).toEqual({ accountId: "acc-1" });
    expect(
      listQuerySchema.parse({ accountId: "acc-1", from: "2026-10-01", to: "2026-10-31", kind: "expense", category: "health", q: " rewe " }),
    ).toEqual({ accountId: "acc-1", from: "2026-10-01", to: "2026-10-31", kind: "expense", category: "health", q: "rewe" });
    expect(listQuerySchema.parse({ accountId: "acc-1", q: "", kind: "", category: "" })).toEqual({ accountId: "acc-1" });
    expect(listQuerySchema.safeParse({}).success).toBe(false);
    expect(listQuerySchema.safeParse({ accountId: "acc-1", from: "yesterday" }).success).toBe(false);
  });
});
