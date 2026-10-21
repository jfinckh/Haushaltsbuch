import type { ParseError } from "./types";

/** Bank exports are small; anything larger is not one. */
export const MAX_FILE_BYTES = 1024 * 1024;

/**
 * The uploaded bytes as text. Strict UTF-8 first (current exports), else Windows-1252 (older ING
 * exports use it). A UTF-8 byte order mark is removed.
 */
export function decodeFile(bytes: Uint8Array): { ok: true; text: string } | ParseError {
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, reason: "too-large" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  if (text.trim() === "") return { ok: false, reason: "empty" };
  return { ok: true, text };
}
