/**
 * Server entry point of the auth module. Import only from server code.
 * Browser-safe exports live in `./index.ts`, the request proxy in `./proxy.ts`.
 */
import "server-only";

export { createAuth } from "./server/create-auth";
export type { Auth, AuthSession, CreateAuthOptions, SignUpCheck } from "./server/create-auth";
export { createAuthServer, toAuthUser } from "./server/guards";
export { hasRole } from "./core/roles";
export type { AuthServer } from "./server/guards";
export { renderAuthEmail } from "./server/email";
export type { RenderedAuthEmail } from "./server/email";
export { migrateAuthSchema } from "./server/migrate";
export * from "./core/types";
