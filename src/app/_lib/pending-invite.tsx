import { getTranslations } from "next-intl/server";
import type { Caller } from "@/shared/rls";
import { auth } from "./auth";
import { households } from "./households";
import { joinInvitersHousehold } from "./invite-actions";

/**
 * A banner for an invite the user has not acted on: why they stay in their own household, or a
 * button to join now. Only reads; joining is the button's server action.
 */
export async function PendingInvite({ caller, userId }: { caller: Caller; userId: string }) {
  const inviter = await auth.getInviter(userId);
  if (!inviter) return null;
  const pending = await households.pendingInvite(caller, { inviterId: inviter.id, invitedAt: inviter.invitedAt });
  if (!pending) return null;
  const t = await getTranslations("app.home");
  if (!pending.canJoin) {
    return (
      <div role="status" className="alert alert-info alert-soft">
        <span>
          {pending.keptReason === "other-members"
            ? t("keptOtherMembers", { name: inviter.name })
            : t("keptSharedAccounts", { name: inviter.name })}
        </span>
      </div>
    );
  }
  return (
    <form action={joinInvitersHousehold} role="status" className="alert alert-info alert-soft">
      <span>{t("canJoin", { name: inviter.name })}</span>
      <button type="submit" className="btn btn-primary btn-sm whitespace-nowrap">
        {t("joinNow")}
      </button>
    </form>
  );
}
