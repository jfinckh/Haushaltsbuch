import "server-only";
import { auth } from "./auth";

/**
 * The invite the signed-in user accepted most recently, as auth records it, or null. Comes from
 * auth's record only, never from request input, so it can be handed to households' join.
 */
export async function currentInvite(): Promise<{ inviterId: string; invitedAt: Date } | null> {
  const session = await auth.getSession();
  const inviter = session && (await auth.getInviter(session.user.id));
  return inviter ? { inviterId: inviter.id, invitedAt: inviter.invitedAt } : null;
}
