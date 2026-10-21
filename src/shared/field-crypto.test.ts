import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFieldCrypto, DecryptionError } from "./field-crypto";

const key = () => randomBytes(32).toString("base64");
const key1 = key();
const key2 = key();
const indexKey = key();

const IBAN = "DE89370400440532013000";

describe("field encryption", () => {
  const crypto = createFieldCrypto({ keys: `1:${key1}`, indexKey });

  it("round-trips a value", () => {
    const value = crypto.encrypt(IBAN, "account.iban");
    expect(crypto.decrypt(value, "account.iban")).toBe(IBAN);
    expect(crypto.decrypt(crypto.encrypt("Ä ö ü ß", "x"), "x")).toBe("Ä ö ü ß");
  });

  it("stores the key version and never the plaintext", () => {
    const value = crypto.encrypt(IBAN, "account.iban");
    expect(value.startsWith("1:")).toBe(true);
    expect(value).not.toContain(IBAN);
    expect(Buffer.from(value.slice(2), "base64").toString("latin1")).not.toContain(IBAN);
  });

  it("uses a fresh IV for every value", () => {
    expect(crypto.encrypt(IBAN, "account.iban")).not.toBe(crypto.encrypt(IBAN, "account.iban"));
  });

  it("does not decrypt in another context", () => {
    const value = crypto.encrypt(IBAN, "account.iban");
    expect(() => crypto.decrypt(value, "transaction.counterparty_iban")).toThrow(DecryptionError);
  });

  it("detects tampering", () => {
    const value = crypto.encrypt(IBAN, "account.iban");
    const bytes = Buffer.from(value.slice(2), "base64");
    bytes[bytes.length - 1] ^= 1;
    expect(() => crypto.decrypt(`1:${bytes.toString("base64")}`, "account.iban")).toThrow(DecryptionError);
    expect(() => crypto.decrypt("1:AAAA", "account.iban")).toThrow(DecryptionError);
    expect(() => crypto.decrypt("garbage", "account.iban")).toThrow(DecryptionError);
  });

  it("does not decrypt with another key", () => {
    const other = createFieldCrypto({ keys: `1:${key2}`, indexKey });
    expect(() => other.decrypt(crypto.encrypt(IBAN, "c"), "c")).toThrow(DecryptionError);
  });

  it("never puts the value into an error message", () => {
    const value = crypto.encrypt(IBAN, "account.iban");
    try {
      crypto.decrypt(value, "other");
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(IBAN);
      expect(String(error)).not.toContain(value);
    }
  });
});

describe("key rotation", () => {
  it("encrypts with the newest key and still decrypts old values", () => {
    const old = createFieldCrypto({ keys: `1:${key1}`, indexKey });
    const rotated = createFieldCrypto({ keys: `1:${key1},2:${key2}`, indexKey });
    const oldValue = old.encrypt(IBAN, "c");
    const newValue = rotated.encrypt(IBAN, "c");
    expect(newValue.startsWith("2:")).toBe(true);
    expect(rotated.decrypt(oldValue, "c")).toBe(IBAN);
    expect(() => old.decrypt(newValue, "c")).toThrow(DecryptionError);
  });

  it("picks the highest version regardless of order", () => {
    const crypto = createFieldCrypto({ keys: ` 3:${key2} , 1:${key1} `, indexKey });
    expect(crypto.encrypt(IBAN, "c").startsWith("3:")).toBe(true);
  });
});

describe("key configuration", () => {
  it.each([
    ["", "At least one"],
    [`x:${key1}`, "<version>:<base64 key>"],
    [`0:${key1}`, "<version>:<base64 key>"],
    [key1, "<version>:<base64 key>"],
    ["1:c2hvcnQ=", "32 bytes"],
    [`1:${key1},1:${key2}`, "twice"],
  ])("rejects keys %j", (keys, message) => {
    expect(() => createFieldCrypto({ keys, indexKey })).toThrow(message);
  });

  it("rejects a short blind index key", () => {
    expect(() => createFieldCrypto({ keys: `1:${key1}`, indexKey: "c2hvcnQ=" })).toThrow("32 bytes");
  });
});

describe("blind index", () => {
  const crypto = createFieldCrypto({ keys: `1:${key1}`, indexKey });

  it("is stable for the same value and context", () => {
    expect(crypto.blindIndex(IBAN, "account.iban")).toBe(crypto.blindIndex(IBAN, "account.iban"));
    expect(crypto.blindIndex(IBAN, "account.iban")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for other values, contexts and keys", () => {
    const index = crypto.blindIndex(IBAN, "account.iban");
    expect(crypto.blindIndex("DE89370400440532013001", "account.iban")).not.toBe(index);
    expect(crypto.blindIndex(IBAN, "transaction.iban")).not.toBe(index);
    expect(createFieldCrypto({ keys: `1:${key1}`, indexKey: key() }).blindIndex(IBAN, "account.iban")).not.toBe(index);
  });

  it("does not change with the encryption key", () => {
    const rotated = createFieldCrypto({ keys: `1:${key1},2:${key2}`, indexKey });
    expect(rotated.blindIndex(IBAN, "account.iban")).toBe(crypto.blindIndex(IBAN, "account.iban"));
  });
});
