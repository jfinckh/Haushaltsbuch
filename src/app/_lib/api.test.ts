import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseQueryError, InvalidSessionError } from "@/shared/rls";
import { asCaller } from "./api";

const signedIn = async () => ({ sessionToken: "token" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("asCaller", () => {
  it("answers 401 without a session and when the session has ended", async () => {
    expect((await asCaller(async () => null, async () => new Response())).status).toBe(401);
    expect((await asCaller(signedIn, async () => Promise.reject(new InvalidSessionError()))).status).toBe(401);
  });

  it("answers any other error with 500 and logs only its name and code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const leaky = Object.assign(new Error("Failed query: insert ... params: 123456,Erika Mustermann"), { code: "23514" });
    const response = await asCaller(signedIn, async () => Promise.reject(leaky));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal error" });
    expect(log).toHaveBeenCalledWith("Request failed", "Error", "23514");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Erika");

    await asCaller(signedIn, async () => Promise.reject(new DatabaseQueryError("23505")));
    expect(log).toHaveBeenLastCalledWith("Request failed", "DatabaseQueryError", "23505");
  });
});
