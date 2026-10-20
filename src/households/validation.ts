import { z } from "zod";

// Shared by the form (client) and the API route (server).

export const createHouseholdSchema = z.object({
  name: z.string().trim().min(1, "Please enter a name.").max(100, "Name is too long."),
});

export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;
