"use server";

// Server actions about invites. Every export here can be called from the browser, so each one
// takes no input and works only with the signed-in caller and auth's invite record.
import { revalidatePath } from "next/cache";
import { requireCaller } from "./caller";
import { currentInvite } from "./current-invite";
import { households } from "./households";

/** Moves the signed-in user into their inviter's household, if their own may be given up. */
export async function joinInvitersHousehold(): Promise<void> {
  const { caller } = await requireCaller("/sign-in");
  await households.joinInvitersHousehold(caller, await currentInvite());
  revalidatePath("/", "layout");
}
