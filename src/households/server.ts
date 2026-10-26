// Server entry point of households: other parts import households' server code only through this file.
import "server-only";

export { createHouseholds } from "./create-households";
export type { Households } from "./contract";
export { householdTables } from "./schema";
