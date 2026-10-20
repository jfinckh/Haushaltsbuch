// Server entry point of auth: other parts import auth's server code only through this file.
import "server-only";

export { createAuth, type Auth, type AuthOptions } from "./create-auth";
export { authTables } from "./schema";
