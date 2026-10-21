import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountList } from "@/accounts";
import { InviteShareButton, SignOutButton } from "@/auth";
import { HouseholdNameEditor, LeaveHouseholdButton } from "@/households";
import { accounts } from "@/app/_lib/accounts";
import { auth } from "@/app/_lib/auth";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { transactions } from "@/app/_lib/transactions";
import { currentBalances } from "@/app/_lib/balances";
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
  const balances = currentBalances(visibleAccounts, await transactions.balances(caller));
  // Only ids of the caller's own household go to auth, so only their names are shown.
  const members = await households.listMembers(caller);
  const memberIds = members.map((m) => m.userId);
  const names = await auth.getUserNames(memberIds);
  const invitedHere = inviter && memberIds.includes(inviter.id);
  const lastMember = household.memberCount === 1;
  const t = await getTranslations("app");
  const format = await getFormatter();
  const memberLine = describeMembers(
    user.id,
    memberIds,
    names,
    { you: t("members.you"), onlyYou: t("members.onlyYou"), aMember: t("members.aMember") },
    (items) => format.list(items, { type: "conjunction" }),
  );

  return (
    <div className="card bg-base-100 w-full max-w-md shadow-md">
      <div className="card-body gap-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="card-title text-2xl">{t("home.greeting", { name: user.name })}</h1>
          <SignOutButton redirectTo="/sign-in" />
        </div>
        <div>
          <HouseholdNameEditor name={household.name} />
          <p className="opacity-70">
            {memberLine}
            {invitedHere && ` · ${t("home.invitedBy", { name: inviter.name })}`}
          </p>
        </div>
        {keptReason && inviter && (
          <div role="status" className="alert alert-info alert-soft">
            <span>
              {keptReason === "other-members"
                ? t("home.keptOtherMembers", { name: inviter.name })
                : t("home.keptSharedAccounts", { name: inviter.name })}
            </span>
          </div>
        )}
        <div className="divider my-0" />
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{t("home.accounts")}</h2>
          <div className="flex gap-2">
            <Link href="/imports" className="btn btn-ghost btn-sm">
              {t("home.importCsv")}
            </Link>
            <Link href="/accounts/new" className="btn btn-primary btn-sm">
              {t("home.addAccount")}
            </Link>
          </div>
        </div>
        <AccountList accounts={visibleAccounts} balances={balances} />
        <div className="divider my-0" />
        <h2 className="font-semibold">{t("home.invitePartner")}</h2>
        <InviteShareButton shareText={t("home.shareText")} />
        <div className="divider my-0" />
        <div className="flex justify-end">
          <LeaveHouseholdButton
            lastMember={lastMember}
            note={
              lastMember ? t("home.leaveNoteLastMember") : t("home.leaveNoteOthers")
            }
          />
        </div>
      </div>
    </div>
  );
}
