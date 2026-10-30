// A page may carry the address of the page it was opened from, so it can link back:
// `?back=<list>` on a booking, `?origin=<overview or statistics>` on the bookings list.
// Only the app's own addresses of the expected pages are accepted, so a parameter can never send anyone elsewhere.

const BASE = "http://app.invalid";
const MAX_LENGTH = 1000;
const LIST_PATH = /^\/(?:transactions|accounts\/[^/]+)?$/;
const ORIGIN_PATH = /^\/(?:statistics(?:\/year|\/merchants)?)?$/;

function safeAddress(value: string | string[] | undefined, path: RegExp): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || raw.length > MAX_LENGTH || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || !path.test(url.pathname)) return null;
  return url.pathname + url.search;
}

/** The return address from a query parameter if it is one of the app's list pages, else null. */
export function safeBack(value: string | string[] | undefined): string | null {
  return safeAddress(value, LIST_PATH);
}

/** The page the bookings list was opened from, if it is the overview or a statistics page, else null. */
export function safeOrigin(value: string | string[] | undefined): string | null {
  return safeAddress(value, ORIGIN_PATH);
}
