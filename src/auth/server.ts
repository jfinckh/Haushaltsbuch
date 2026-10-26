// Server entry point of auth: other parts import auth's server code only through this file.
import "server-only";

export { createAuth, type AuthOptions } from "./create-auth";
export type { Auth } from "./contract";
export { authTables } from "./schema";
