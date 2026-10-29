import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

const asMap = (development: boolean) => new Map(securityHeaders({ development }).map((h) => [h.key, h.value]));

describe("securityHeaders", () => {
  it("locks pages down in production", () => {
    const headers = asMap(false);
    const csp = headers.get("Content-Security-Policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws:");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("same-origin");
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
  });

  it("allows eval and hot reload only in development, without HSTS", () => {
    const headers = asMap(true);
    const csp = headers.get("Content-Security-Policy")!;
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws:");
    expect(headers.has("Strict-Transport-Security")).toBe(false);
  });
});
