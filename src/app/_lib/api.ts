import "server-only";
import { InvalidSessionError, type Caller } from "@/shared/rls";

export type GetCaller = () => Promise<Caller | null>;

export const json = (body: unknown, status = 200) => Response.json(body, { status });
export const unauthorized = () => json({ error: "Unauthorized" }, 401);
export const notFound = () => json({ error: "Not found" }, 404);
export const invalidInput = () => json({ error: "Invalid input" }, 400);
export const internalError = () => json({ error: "Internal error" }, 500);

/**
 * Runs `handle` for the signed-in caller. 401 without a session, also when the database finds the
 * session no longer valid (signed out or expired in the meantime). Any other error answers 500 and is
 * logged by name and code only, never with its message, which may hold booking data.
 */
export async function asCaller(getCaller: GetCaller, handle: (caller: Caller) => Promise<Response>) {
  const caller = await getCaller();
  if (!caller) return unauthorized();
  try {
    return await handle(caller);
  } catch (error) {
    if (error instanceof InvalidSessionError) return unauthorized();
    const code = (error as { code?: unknown } | null)?.code;
    console.error("Request failed", error instanceof Error ? error.name : "unknown", typeof code === "string" ? code : "");
    return internalError();
  }
}

/** The JSON body, or null if it is not valid JSON. */
export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
