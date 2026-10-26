import { afterEach, describe, expect, it, vi } from "vitest";
import { callApi } from "./api-client";

const calls: { url: string; init: RequestInit }[] = [];

function stubFetch(answer: () => Promise<Response>) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("callApi", () => {
  it("sends JSON with its content type and returns the body", async () => {
    stubFetch(async () => Response.json({ transaction: { id: "t1" } }, { status: 201 }));
    const result = await callApi<{ transaction: { id: string } }>("/api/transactions", { json: { amount: "1,00" } });
    expect(result).toEqual({ ok: true, status: 201, data: { transaction: { id: "t1" } } });
    expect(calls[0].init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" }, body: '{"amount":"1,00"}' });
  });

  it("sends form data as it is and uses the given method", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("accountId", "a1");
    expect(await callApi("/api/imports", { method: "PUT", form })).toEqual({ ok: true, status: 204, data: undefined });
    expect(calls[0].init.method).toBe("PUT");
    expect(calls[0].init.body).toBe(form);
  });

  it("defaults to GET without a body", async () => {
    stubFetch(async () => Response.json({ imports: [] }));
    await callApi("/api/imports");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
  });

  it("returns the status and the API's error code on failure", async () => {
    stubFetch(async () => Response.json({ error: "preview-outdated" }, { status: 409 }));
    expect(await callApi("/api/imports", { json: {} })).toEqual({ ok: false, status: 409, error: "preview-outdated", body: { error: "preview-outdated" } });
    stubFetch(async () => new Response("Not found", { status: 404 }));
    expect(await callApi("/api/x", { method: "DELETE" })).toEqual({ ok: false, status: 404, error: null, body: undefined });
  });

  it("turns a network error into status 0 instead of throwing", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await callApi("/api/x", { method: "DELETE" })).toEqual({ ok: false, status: 0, error: null, body: undefined });
  });
});
