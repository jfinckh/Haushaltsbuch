import { getCaller } from "@/app/_lib/caller";
import { categories } from "@/app/_lib/categories";
import { categoryRoute } from "@/app/_lib/categories-route";

export const { PATCH } = categoryRoute({ categories, getCaller });
