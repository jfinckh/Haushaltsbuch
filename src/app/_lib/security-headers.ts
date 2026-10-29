// Security headers for every response (next.config.ts). Imported by next.config.ts, so no
// "server-only" and no path aliases here.
//
// Scripts need 'unsafe-inline': Next.js puts inline scripts into every page, and a nonce would
// force every page to render per request (no partial prerendering). The policy still blocks
// scripts from other sites, framing by other sites and sending data anywhere but the app.

export type Header = { key: string; value: string };

/** The security headers; `development` allows what `next dev` needs (eval, hot reload). */
export function securityHeaders({ development }: { development: boolean }): Header[] {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${development ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  const headers: Header[] = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
  // Only in production: a browser that saw it once refuses plain http for two years.
  if (!development) headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  return headers;
}
