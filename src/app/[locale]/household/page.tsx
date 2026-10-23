import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountList } from "@/accounts";
import { InviteShareButton } from "@/auth";
import { HouseholdNameEditor, LeaveHouseholdButton } from "@/households";
import { AppShell, PageHeader, Section } from "@/app/_lib/app-shell";
import { accounts } from "@/app/_lib/accounts";
import { auth } from "@/app/_lib/auth";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { insights } from "@/app/_lib/insights";
import { describeMembers } from "@/app/_lib/member-names";

export default function HouseholdPage() {
  return (
    <AppShell>
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Household />
      </Suspense>
    </AppShell>
  );
}

/** Household, members, accounts with balances, invite and leave. */
async function Household() {
  const { user, caller } = await requireCaller("/sign-in");
  const household = await households.getHousehold(caller);
  if (!household) redirect("/household/new");
  const [inviter, visibleAccounts, members] = await Promise.all([
    auth.getInviter(user.id),
    accounts.listAccounts(caller),
    households.listMembers(caller),
  ]);
  const balances = await insights.balances(caller, visibleAccounts);
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

  const links = [
    ["/imports", t("home.importCsv")],
    ["/rules", t("home.rules")],
    ["/categories", t("home.categories")],
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("home.manage")} />
      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-10">
        <div className="flex min-w-0 flex-col gap-8">
          <div>
            <HouseholdNameEditor name={household.name} />
            <p className="text-sm text-base-content/60">
              {memberLine}
              {invitedHere && ` · ${t("home.invitedBy", { name: inviter.name })}`}
            </p>
          </div>
          <Section
            title={t("home.accounts")}
            actions={
              <Link href="/accounts/new" className="btn btn-primary btn-sm">
                {t("home.addAccount")}
              </Link>
            }
          >
            <AccountList accounts={visibleAccounts} balances={balances} />
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          <Section title={t("home.invitePartner")}>
            <InviteShareButton shareText={t("home.shareText")} />
          </Section>
          <Section>
            <ul className="flex flex-col text-sm">
              {links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="flex items-center justify-between py-1.5 hover:text-primary">
                    {label}
                    <span aria-hidden="true" className="text-base-content/40">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
          <Section>
            <LeaveHouseholdButton lastMember={lastMember} note={lastMember ? t("home.leaveNoteLastMember") : t("home.leaveNoteOthers")} />
          </Section>
        </div>
      </div>
    </div>
  );
}
