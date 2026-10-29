// Cross-site request forgery: another website open in the same browser could send a form or a
// fetch to the API, and the browser would attach the login cookies. Browsers put an Origin header
// on every request that is not GET or HEAD, so a write is accepted only with the app's own origin.

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Whether the request may pass: a read, or a write whose Origin is `appOrigin` (e.g. https://haushalt.example). */
export function isSameOriginWrite(request: { method: string; headers: Headers }, appOrigin: string): boolean {
  if (READ_METHODS.has(request.method.toUpperCase())) return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}
