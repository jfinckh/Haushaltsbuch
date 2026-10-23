import "server-only";
import type { Categories } from "@/transactions/server";
import { asCaller, invalidInput, json, notFound, readJson, type GetCaller } from "./api";

type Deps = {
  categories: Categories;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

type IdContext = { params: Promise<{ id: string }> };

const failed = (reason: "invalid-input" | "not-found" | "duplicate") =>
  reason === "not-found" ? notFound() : reason === "duplicate" ? json({ error: "duplicate" }, 409) : invalidInput();

/**
 * Handlers for /api/categories. Personal categories exist only for their owner and household ones only
 * for the household's members: anything else gets the same 404 as an unknown id.
 */
export function categoriesRoute({ categories, getCaller }: Deps) {
  return {
    /** The caller's household and personal categories and hidden standard keys. */
    async GET() {
      return asCaller(getCaller, async (caller) => json(await categories.listCategories(caller)));
    },

    /** Body: { scope, kind, parentKey?, name }. */
    async POST(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const result = await categories.createCategory(caller, await readJson(request));
        return result.ok ? json({ category: result.category }, 201) : failed(result.reason);
      });
    },
  };
}

/** Handlers for /api/categories/[id]. */
export function categoryRoute({ categories, getCaller }: Deps) {
  return {
    /** Body: { name } to rename, or { archived } to archive or restore. */
    async PATCH(request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const id = (await params).id;
        const body = (await readJson(request)) as Record<string, unknown> | null;
        if (body === null || typeof body !== "object") return invalidInput();
        const result = "archived" in body ? await categories.setArchived(caller, id, body.archived) : await categories.renameCategory(caller, id, body);
        return result.ok ? json({ category: result.category }) : failed(result.reason);
      });
    },
  };
}

/** Handlers for /api/categories/hidden. */
export function hiddenCategoriesRoute({ categories, getCaller }: Deps) {
  return {
    /** Body: { scope, key, hidden }. */
    async PUT(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const result = await categories.setHidden(caller, await readJson(request));
        return result.ok ? json({ ok: true }) : failed(result.reason);
      });
    },
  };
}
