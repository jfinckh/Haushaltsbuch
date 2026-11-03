import "server-only";
import type { Recurring } from "@/recurring/server";
import { asCaller, invalidInput, json, notFound, readJson, type GetCaller } from "./api";

type Deps = {
  recurring: Pick<Recurring, "act" | "deleteTemplate">;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

type IdContext = { params: Promise<{ id: string }> };

/**
 * Handlers for /api/recurring/[id]. A template on an account the caller may not see gets the same
 * 404 as an unknown id.
 */
export function recurringRoute({ recurring, getCaller }: Deps) {
  return {
    /** Body: `{ action: "pause" | "resume" | "end" }`. */
    async PATCH(request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const result = await recurring.act(caller, (await params).id, await readJson(request));
        if (result.ok) return json({ template: result.template });
        return result.reason === "not-found" ? notFound() : invalidInput();
      });
    },

    async DELETE(_request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) =>
        (await recurring.deleteTemplate(caller, (await params).id)) ? json({ deleted: true }) : notFound(),
      );
    },
  };
}
