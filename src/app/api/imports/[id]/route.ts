import { getCaller } from "@/app/_lib/caller";
import { imports } from "@/app/_lib/imports";
import { importRoute } from "@/app/_lib/imports-route";

export const { DELETE } = importRoute({ imports, getCaller });
