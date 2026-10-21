import { z } from "zod";

// Input of the manual transfer actions, as the components send it. Browser-safe.

const id = z.string().min(1).max(100);

export const transferActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), partnerId: id }),
  z.object({ action: z.literal("unlink") }),
  z.object({ action: z.literal("set-kind"), kind: z.enum(["expense", "income", "transfer", "saving"]) }),
  z.object({
    action: z.literal("no-partner"),
    target: z.discriminatedUnion("type", [
      z.object({ type: z.literal("external") }),
      z.object({ type: z.literal("account"), accountId: id }),
    ]),
  }),
]);

export const proposalActionSchema = z.object({ action: z.enum(["accept", "reject"]) });

export type TransferAction = z.infer<typeof transferActionSchema>;
