import { createAuthClient } from "better-auth/react";
import { invitesClient } from "./invite/client";

// Talks to the auth handler on the same origin (/api/auth).
export const authClient = createAuthClient({ plugins: [invitesClient()] });

export const useSession = authClient.useSession;

export type SessionUser = typeof authClient.$Infer.Session.user;
