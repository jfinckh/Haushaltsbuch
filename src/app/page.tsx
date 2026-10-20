import { redirect } from "next/navigation";
import { Suspense } from "react";
import { InviteShareButton, SignOutButton } from "@/auth";
import { HouseholdNameEditor, LeaveHouseholdButton } from "@/households";
import { auth } from "@/app/_lib/auth";
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
  const { user } = await auth.requireSession("/sign-in");
  const inviter = await auth.getInviter(user.id);
  const { keptOwnHousehold } = await households.joinInvitersHousehold(
    user.id,
    inviter && { inviterId: inviter.id, invitedAt: inviter.invitedAt },
  );
  const household = await households.getHousehold(user.id);
  if (!household) redirect("/household/new");
  // Only ids of the caller's own household go to auth, so only their names are shown.
  const members = await households.listMembers(user.id);
  const memberIds = members.map((m) => m.userId);
  const names = await auth.getUserNames(memberIds);
  const invitedHere = inviter && memberIds.includes(inviter.id);

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
        {keptOwnHousehold && inviter && (
          <div role="status" className="alert alert-info alert-soft">
            <span>
              {inviter.name} invited you to their household. You stay in yours because it has other members. Leave it
              to join theirs.
            </span>
          </div>
        )}
        <div className="divider my-0" />
        <h2 className="font-semibold">Invite your partner</h2>
        <InviteShareButton shareText="Join our Haushaltsbuch:" />
        <div className="divider my-0" />
        <div className="flex justify-end">
          <LeaveHouseholdButton lastMember={household.memberCount === 1} />
        </div>
      </div>
    </div>
  );
}
