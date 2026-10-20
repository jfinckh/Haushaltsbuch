import { passkeyClient } from "@better-auth/passkey/client";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** The better-auth client with the plugins the auth module's server uses. */
export function createAppAuthClient(options: { baseURL?: string } = {}) {
  return createAuthClient({
    baseURL: options.baseURL,
    plugins: [adminClient(), twoFactorClient(), passkeyClient()],
  });
}

export type AppAuthClient = ReturnType<typeof createAppAuthClient>;
