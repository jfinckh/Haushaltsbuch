import { getCaller } from "@/app/_lib/caller";
import { categories } from "@/app/_lib/categories";
import { categoriesRoute } from "@/app/_lib/categories-route";

export const { GET, POST } = categoriesRoute({ categories, getCaller });
