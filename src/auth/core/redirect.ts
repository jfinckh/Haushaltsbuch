/**
 * Only allow same-origin relative paths as redirect targets, so a crafted
 * `?redirectTo=https://evil.example` can't send users elsewhere after login.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  // "//host" and "/\host" are protocol-relative URLs in browsers.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

export function withRedirect(path: string, redirectTo: string | undefined) {
  if (!redirectTo || redirectTo === "/") return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}redirectTo=${encodeURIComponent(redirectTo)}`;
}
