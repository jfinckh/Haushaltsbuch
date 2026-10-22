import type { BetterAuthClientPlugin } from "better-auth/client";
import type { invites } from "./plugin";

export const invitesClient = () =>
  ({
    id: "invites",
    $InferServerPlugin: {} as ReturnType<typeof invites>,
    // Calls without a body default to GET; these endpoints are POST-only.
    pathMethods: { "/invite/create": "POST", "/invite/open": "POST", "/invite/accept": "POST" },
  }) satisfies BetterAuthClientPlugin;
