// Server entry point of budgets: other parts import budgets' server code only through this file.
import "server-only";

export { createBudgets } from "./create-budgets";
export type { Budgets } from "./contract";
