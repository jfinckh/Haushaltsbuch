import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AccountList } from "@/accounts";
import { InviteShareButton, SignOutButton } from "@/auth";
import { HouseholdNameEditor, LeaveHouseholdButton } from "@/households";
import { accounts } from "@/app/_lib/accounts";
import { auth } from "@/app/_lib/auth";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { describeMembers } from "@/app/_lib/member-names";

export default function Home() {
  return (
    <main className="flex flex-1 items-start justify-center p-4 sm:items-center">
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Welcome />
      </Suspense>
    </main>
  );
}

async function Welcome() {
  const { user, caller } = await requireCaller("/sign-in");
  const inviter = await auth.getInviter(user.id);
  const { keptReason } = await households.joinInvitersHousehold(
    caller,
    inviter && { inviterId: inviter.id, invitedAt: inviter.invitedAt },
  );
  const household = await households.getHousehold(caller);
  if (!household) redirect("/household/new");
  const visibleAccounts = await accounts.listAccounts(caller);
  // Only ids of the caller's own household go to auth, so only their names are shown.
  const members = await households.listMembers(caller);
  const memberIds = members.map((m) => m.userId);
  const names = await auth.getUserNames(memberIds);
  const invitedHere = inviter && memberIds.includes(inviter.id);
  const lastMember = household.memberCount === 1;

  return (
    <div className="card bg-base-100 w-full max-w-md shadow-md">
      <div className="card-body gap-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="card-title text-2xl">Hello, {user.name}</h1>
          <SignOutButton redirectTo="/sign-in" />
        </div>
        <div>
          <HouseholdNameEditor name={household.name} />
          <p className="opacity-70">
            {describeMembers(user.id, memberIds, names)}
            {invitedHere && ` · invited by ${inviter.name}`}
          </p>
        </div>
        {keptReason && inviter && (
          <div role="status" className="alert alert-info alert-soft">
            <span>
              {keptReason === "other-members"
                ? `${inviter.name} invited you to their household. You stay in yours because it has other members. Leave it to join theirs.`
                : `${inviter.name} invited you to their household. You stay in yours because it has shared accounts. Leave it to join theirs. Leaving deletes the shared accounts; your private accounts stay with you.`}
            </span>
          </div>
        )}
        <div className="divider my-0" />
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Accounts</h2>
          <Link href="/accounts/new" className="btn btn-primary btn-sm">
            Add account
          </Link>
        </div>
        <AccountList accounts={visibleAccounts} />
        <div className="divider my-0" />
        <h2 className="font-semibold">Invite your partner</h2>
        <InviteShareButton shareText="Join our Haushaltsbuch:" />
        <div className="divider my-0" />
        <div className="flex justify-end">
          <LeaveHouseholdButton
            lastMember={lastMember}
            note={
              lastMember
                ? "Its shared accounts are deleted with it. Your private accounts stay with you."
                : "Your private accounts stay with you. Shared accounts stay with the household."
            }
          />
        </div>
      </div>
    </div>
  );
}
