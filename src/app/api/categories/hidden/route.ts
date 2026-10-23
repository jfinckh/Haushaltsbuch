import { getCaller } from "@/app/_lib/caller";
import { categories } from "@/app/_lib/categories";
import { hiddenCategoriesRoute } from "@/app/_lib/categories-route";

export const { PUT } = hiddenCategoriesRoute({ categories, getCaller });
