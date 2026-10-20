// Server entry point of households: other parts import households' server code only through this file.
import "server-only";

export { createHouseholds, NoHouseholdError } from "./create-households";
export { householdTables } from "./schema";
