import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountList } from "@/accounts";
import { InviteShareButton } from "@/auth";
import { HouseholdNameEditor, LeaveHouseholdButton } from "@/households";
import { accounts } from "@/app/_lib/accounts";
import { auth } from "@/app/_lib/auth";
import { currentBalances } from "@/app/_lib/balances";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { describeMembers } from "@/app/_lib/member-names";
import { transactions } from "@/app/_lib/transactions";

export default function HouseholdPage() {
  return (
    <main className="flex flex-1 items-start justify-center p-4">
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Household />
      </Suspense>
    </main>
  );
}

/** Household, members, accounts with balances, invite and leave. */
async function Household() {
  const { user, caller } = await requireCaller("/sign-in");
  const household = await households.getHousehold(caller);
  if (!household) redirect("/household/new");
  const [inviter, visibleAccounts, sums, members] = await Promise.all([
    auth.getInviter(user.id),
    accounts.listAccounts(caller),
    transactions.balances(caller),
    households.listMembers(caller),
  ]);
  const balances = currentBalances(visibleAccounts, sums);
  // Only ids of the caller's own household go to auth, so only their names are shown.
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
          <h1 className="card-title text-2xl">{t("home.manage")}</h1>
          <Link href="/" className="btn btn-ghost btn-sm">
            {t("household.back")}
          </Link>
        </div>
        <div>
          <HouseholdNameEditor name={household.name} />
          <p className="opacity-70">
            {memberLine}
            {invitedHere && ` · ${t("home.invitedBy", { name: inviter.name })}`}
          </p>
        </div>
        <div className="divider my-0" />
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{t("home.accounts")}</h2>
          <div className="flex gap-2">
            <Link href="/imports" className="btn btn-ghost btn-sm">
              {t("home.importCsv")}
            </Link>
            <Link href="/rules" className="btn btn-ghost btn-sm">
              {t("home.rules")}
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
            note={lastMember ? t("home.leaveNoteLastMember") : t("home.leaveNoteOthers")}
          />
        </div>
      </div>
    </div>
  );
}
