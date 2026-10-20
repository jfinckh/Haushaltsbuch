import { createAuthClient } from "better-auth/client";
import { describe, expect, it } from "vitest";
import { createTestAuth, TEST_BASE_URL } from "../test-utils";
import { invitesClient } from "./client";

describe("invites client plugin", () => {
  it("calls the invite endpoints with the right HTTP methods", async () => {
    const { auth } = await createTestAuth();
    const client = createAuthClient({
      baseURL: TEST_BASE_URL,
      plugins: [invitesClient()],
      fetchOptions: {
        customFetchImpl: (input, init) => {
          const request = new Request(input, init);
          request.headers.set("origin", TEST_BASE_URL);
          return auth.handler(request);
        },
      },
    });

    // Not signed in: 401 from the real endpoint, not 404 from a wrong method.
    expect((await client.invite.create()).error?.status).toBe(401);
    expect((await client.invite.inviter()).error?.status).toBe(401);
    expect((await client.invite.open({ token: "unknown" })).data).toEqual({ valid: false });
  });
});
