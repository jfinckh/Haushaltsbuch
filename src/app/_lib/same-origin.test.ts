import { describe, expect, it } from "vitest";
import { isSameOriginWrite } from "./same-origin";

const APP = "https://haushalt.example";
const request = (method: string, origin?: string) => ({
  method,
  headers: new Headers(origin === undefined ? {} : { origin }),
});

describe("isSameOriginWrite", () => {
  it.each(["GET", "HEAD", "OPTIONS", "get"])("lets %s pass without an origin", (method) => {
    expect(isSameOriginWrite(request(method), APP)).toBe(true);
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"])("accepts %s from the app itself", (method) => {
    expect(isSameOriginWrite(request(method, APP), APP)).toBe(true);
  });

  it("ignores a trailing path or slash in the configured address", () => {
    expect(isSameOriginWrite(request("POST", APP), `${APP}/`)).toBe(true);
  });

  it.each([
    ["no origin", undefined],
    ["another site", "https://evil.example"],
    ["a subdomain", "https://evil.haushalt.example"],
    ["plain http", "http://haushalt.example"],
    ["another port", "https://haushalt.example:8443"],
    ["an opaque origin", "null"],
    ["garbage", "not a url"],
  ])("refuses a write from %s", (_label, origin) => {
    expect(isSameOriginWrite(request("POST", origin), APP)).toBe(false);
  });
});
