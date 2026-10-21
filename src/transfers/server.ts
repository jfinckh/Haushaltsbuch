// Server entry point of transfers: other parts import transfers' server code only through this file.
import "server-only";

export { createTransfers, type Transfers } from "./create-transfers";
