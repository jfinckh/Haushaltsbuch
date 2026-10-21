import { splitLines } from "./csv";
import { decodeFile } from "./decode";
import { isIngHeader, parseIng } from "./ing";
import { isTradeRepublicHeader, parseTradeRepublic } from "./trade-republic";
import type { ParseResult } from "./types";

/** Decodes an uploaded export, finds the bank from its columns and reads it. */
export function parseBankFile(bytes: Uint8Array): ParseResult {
  const decoded = decodeFile(bytes);
  if (!decoded.ok) return decoded;
  const lines = splitLines(decoded.text);
  if (isTradeRepublicHeader(lines[0] ?? "")) return parseTradeRepublic(decoded.text);
  if (lines.some(isIngHeader)) return parseIng(decoded.text);
  return { ok: false, reason: "unknown-format" };
}
