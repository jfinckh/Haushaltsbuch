import "server-only";
import type { Recurring } from "@/recurring/server";
import { asCaller, invalidInput, json, notFound, readJson, type GetCaller } from "./api";

type Deps = {
  recurring: Pick<Recurring, "act" | "deleteTemplate" | "createTemplate" | "updateTemplate">;
  /** The signed-in caller, or null. */
  getCaller: GetCaller;
};

type IdContext = { params: Promise<{ id: string }> };

/**
 * Handlers for /api/recurring (POST) and /api/recurring/[id] (PATCH, DELETE). A template on an account the caller may not see gets the same
 * 404 as an unknown id.
 */
export function recurringRoute({ recurring, getCaller }: Deps) {
  return {
    /** Body: the template form's fields. 201 with `{ template }`. */
    async POST(request: Request) {
      return asCaller(getCaller, async (caller) => {
        const result = await recurring.createTemplate(caller, await readJson(request));
        if (result.ok) return json({ template: result.template }, 201);
        return result.reason === "not-found" ? notFound() : invalidInput();
      });
    },

    /** Body: `{ action: "pause" | "resume" | "end" }`, or the template form's fields to change it. */
    async PATCH(request: Request, { params }: IdContext) {
      return asCaller(getCaller, async (caller) => {
        const { id } = await params;
        const body = await readJson(request);
        const result =
          body && typeof body === "object" && "action" in body ? await recurring.act(caller, id, body) : await recurring.updateTemplate(caller, id, body);
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
