// A detail page may carry `?back=<address of the list it was opened from>`. Only the app's own
// list addresses are accepted, so the parameter can never send anyone elsewhere.

const BASE = "http://app.invalid";
const MAX_LENGTH = 1000;
const PATH = /^\/(?:transactions|accounts\/[^/]+)?$/;

/** The return address from a query parameter if it is one of the app's list pages, else null. */
export function safeBack(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || raw.length > MAX_LENGTH || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || !PATH.test(url.pathname)) return null;
  return url.pathname + url.search;
}
