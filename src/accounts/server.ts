// Server entry point of accounts: other parts import accounts' server code only through this file.
import "server-only";

export { createAccounts, type Accounts } from "./create-accounts";
