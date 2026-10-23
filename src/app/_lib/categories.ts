import "server-only";
import { db } from "@/db/server";
import { createCategories } from "@/transactions/server";

export const categories = createCategories({ db });
