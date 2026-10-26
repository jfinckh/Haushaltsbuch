// Browser calls to the app's own API. One place that builds the request, reads the answer and
// turns a dropped connection into an ordinary failed result, so no form waits forever.

/**
 * What an API call returned. `status` 0: no response at all (network error). `error`: the API's
 * error code (`{ "error": "..." }`), or null; `body`: the whole error body, for extra details.
 */
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string | null; body: unknown };

export type ApiOptions = {
  /** Default: GET, or POST when a body is given. */
  method?: string;
  /** Sent as a JSON body. */
  json?: unknown;
  /** Sent as multipart form data (e.g. a file upload). */
  form?: FormData;
};

/**
 * Calls the app's API and never throws. `T` is the response body the caller expects on success;
 * it is not checked at runtime (the route and its tests define it). A response without a JSON
 * body gives `data: undefined`.
 */
export async function callApi<T = undefined>(url: string, { method, json, form }: ApiOptions = {}): Promise<ApiResult<T>> {
  const hasBody = json !== undefined || form !== undefined;
  let response: Response;
  try {
    response = await fetch(url, {
      method: method ?? (hasBody ? "POST" : "GET"),
      ...(json !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(json) } : {}),
      ...(form !== undefined ? { body: form } : {}),
    });
  } catch {
    return { ok: false, status: 0, error: null, body: undefined };
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) return { ok: true, status: response.status, data: body as T };
  const error = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
  return { ok: false, status: response.status, error, body };
}
