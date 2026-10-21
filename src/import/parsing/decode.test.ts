import { describe, expect, it } from "vitest";
import { decodeFile, MAX_FILE_BYTES } from "./decode";

describe("decodeFile", () => {
  it("reads UTF-8 and strips a byte order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Währung;Betrag")]);
    expect(decodeFile(bytes)).toEqual({ ok: true, text: "Währung;Betrag" });
  });

  it("falls back to Windows-1252 for older ING exports", () => {
    // "Währung" with ä as 0xE4 is not valid UTF-8.
    const bytes = new Uint8Array([0x57, 0xe4, 0x68, 0x72, 0x75, 0x6e, 0x67, 0x3b, 0x80]);
    expect(decodeFile(bytes)).toEqual({ ok: true, text: "Währung;€" });
  });

  it("rejects files that are too large", () => {
    expect(decodeFile(new Uint8Array(MAX_FILE_BYTES + 1))).toEqual({ ok: false, reason: "too-large" });
  });

  it("rejects empty files", () => {
    expect(decodeFile(new TextEncoder().encode(" \r\n"))).toEqual({ ok: false, reason: "empty" });
  });
});
