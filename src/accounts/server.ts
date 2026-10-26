// Server entry point of accounts: other parts import accounts' server code only through this file.
import "server-only";

export { createAccounts } from "./create-accounts";
export type { Accounts } from "./contract";
