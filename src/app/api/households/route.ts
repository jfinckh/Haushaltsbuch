import { getCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { householdsRoute } from "@/app/_lib/households-route";

export const { GET, POST, PATCH } = householdsRoute({ households, getCaller });
