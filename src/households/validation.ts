import { z } from "zod";

// Shared by the form (client) and the API route (server). Messages are translation keys;
// the forms translate them.

export const createHouseholdSchema = z.object({
  name: z.string().trim().min(1, "households.validation.nameRequired").max(100, "households.validation.nameTooLong"),
});

export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;

// Renaming follows the same rules as creating.
export const renameHouseholdSchema = createHouseholdSchema;
