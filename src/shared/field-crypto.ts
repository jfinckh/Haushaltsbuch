import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

// Field-level encryption for sensitive values (IBANs, names, references, raw import rows).
// Keys come from the environment, never the database. Each encrypted value carries the version
// of its key, so keys can be rotated: new values use the newest key, old ones still decrypt.
// Error messages never contain plaintext or ciphertext.

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type FieldCryptoOptions = {
  /** Comma-separated `<version>:<base64 32-byte key>` pairs; the highest version encrypts. */
  keys: string;
  /** Base64 32-byte key for blind indexes. */
  indexKey: string;
};

export type FieldCrypto = ReturnType<typeof createFieldCrypto>;

/** Thrown for a value that cannot be decrypted (unknown key version, tampered, wrong context). */
export class DecryptionError extends Error {
  constructor() {
    super("Could not decrypt value");
    this.name = "DecryptionError";
  }
}

function decodeKey(base64: string, label: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_BYTES) throw new Error(`${label} must be ${KEY_BYTES} bytes, base64-encoded`);
  return key;
}

function parseKeyRing(keys: string): Map<number, Buffer> {
  const ring = new Map<number, Buffer>();
  for (const entry of keys.split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    const version = Number(entry.slice(0, separator));
    if (separator < 1 || !Number.isInteger(version) || version < 1) {
      throw new Error("Encryption keys must look like <version>:<base64 key>");
    }
    if (ring.has(version)) throw new Error(`Encryption key version ${version} is listed twice`);
    ring.set(version, decodeKey(entry.slice(separator + 1), `Encryption key ${version}`));
  }
  if (ring.size === 0) throw new Error("At least one encryption key is required");
  return ring;
}

/**
 * Encrypts and decrypts single field values. `context` names where the value lives (e.g.
 * "account.iban"); it is authenticated, so a value copied to another column does not decrypt.
 */
export function createFieldCrypto({ keys, indexKey }: FieldCryptoOptions) {
  const ring = parseKeyRing(keys);
  const currentVersion = Math.max(...ring.keys());
  const hmacKey = decodeKey(indexKey, "Blind index key");

  return {
    /** Encrypts `plaintext` with the newest key: `<version>:<base64 iv‖tag‖ciphertext>`. */
    encrypt(plaintext: string, context: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, ring.get(currentVersion)!, iv);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return `${currentVersion}:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
    },

    /** Decrypts a value from `encrypt`; throws DecryptionError if it cannot. */
    decrypt(value: string, context: string): string {
      const separator = value.indexOf(":");
      const key = ring.get(Number(value.slice(0, separator)));
      const payload = Buffer.from(value.slice(separator + 1), "base64");
      if (separator < 1 || !key || payload.length < IV_BYTES + TAG_BYTES) throw new DecryptionError();
      try {
        const decipher = createDecipheriv(ALGORITHM, key, payload.subarray(0, IV_BYTES));
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        return Buffer.concat([decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
      } catch {
        throw new DecryptionError();
      }
    },

    /**
     * A keyed hash for exact-match lookups without decrypting (hex). Normalize `value` first; the
     * same value in another context gives another index.
     */
    blindIndex(value: string, context: string): string {
      return createHmac("sha256", hmacKey).update(context, "utf8").update("\0").update(value, "utf8").digest("hex");
    },
  };
}
