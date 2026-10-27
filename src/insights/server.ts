// Server entry point of insights: other parts import insights' server code only through this file.
import "server-only";

export { createInsights } from "./create-insights";
export type { CategoryTrends, Insights, StatisticsRow, YearOverview } from "./contract";
