import { accounts } from "@/app/_lib/accounts";
import { getCaller } from "@/app/_lib/caller";
import { imports } from "@/app/_lib/imports";
import { importPreviewRoute } from "@/app/_lib/imports-route";

export const { POST } = importPreviewRoute({ imports, accounts, getCaller });
