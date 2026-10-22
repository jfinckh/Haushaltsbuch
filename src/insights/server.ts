// Server entry point of insights: other parts import insights' server code only through this file.
import "server-only";

export { createInsights, type Insights } from "./create-insights";
export type { StatisticsRow } from "./statistics";
