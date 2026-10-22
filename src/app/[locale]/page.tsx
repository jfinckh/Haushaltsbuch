import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SignOutButton } from "@/auth";
import { BudgetSection } from "@/budgets";
import { accounts } from "@/app/_lib/accounts";
import { auth } from "@/app/_lib/auth";
import { budgets } from "@/app/_lib/budgets";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { selectAccount } from "@/app/_lib/select-account";
import { transactions } from "@/app/_lib/transactions";
import { formatEuro } from "@/shared/money";
import type { Caller } from "@/shared/rls";
import { TransactionList } from "@/transactions";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** How many of the newest bookings the dashboard shows. */
const LATEST = 8;

export default function Home(props: Props) {
  return (
    <main className="flex flex-1 items-start justify-center p-4">
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Dashboard {...props} />
      </Suspense>
    </main>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** One account at a time (?account=<id>): available this month, budgets, newest bookings. */
async function Dashboard({ searchParams }: Props) {
  const { user, caller } = await requireCaller("/sign-in");
  const inviter = await auth.getInviter(user.id);
  const { keptReason } = await households.joinInvitersHousehold(
    caller,
    inviter && { inviterId: inviter.id, invitedAt: inviter.invitedAt },
  );
  const household = await households.getHousehold(caller);
  if (!household) redirect("/household/new");
  // Only accounts the caller may see; any other id falls back to the first active account.
  const visibleAccounts = await accounts.listAccounts(caller);
  const selected = selectAccount(visibleAccounts, first((await searchParams).account));
  const t = await getTranslations("app.home");

  return (
    <div className="card bg-base-100 w-full max-w-md shadow-md">
      <div className="card-body gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="card-title text-2xl">{t("greeting", { name: user.name })}</h1>
          <div className="flex shrink-0 gap-1">
            <Link href="/household" className="btn btn-ghost btn-sm">
              {t("manage")}
            </Link>
            <SignOutButton redirectTo="/sign-in" />
          </div>
        </div>
        {keptReason && inviter && (
          <div role="status" className="alert alert-info alert-soft">
            <span>
              {keptReason === "other-members"
                ? t("keptOtherMembers", { name: inviter.name })
                : t("keptSharedAccounts", { name: inviter.name })}
            </span>
          </div>
        )}
        {selected ? (
          <>
            <nav aria-label={t("switcher")} className="overflow-x-auto">
              <div role="tablist" className="tabs tabs-box w-max">
                {visibleAccounts
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <Link
                      key={a.id}
                      href={`/?account=${a.id}`}
                      role="tab"
                      aria-current={a.id === selected.id ? "page" : undefined}
                      className={`tab whitespace-nowrap ${a.id === selected.id ? "tab-active" : ""}`}
                    >
                      {a.name}
                    </Link>
                  ))}
              </div>
            </nav>
            <AccountDashboard caller={caller} accountId={selected.id} />
          </>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="opacity-70">{t("noAccounts")}</p>
            <Link href="/accounts/new" className="btn btn-primary btn-sm">
              {t("addAccount")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

async function AccountDashboard({ caller, accountId }: { caller: Caller; accountId: string }) {
  const [summary, budgetList, latest] = await Promise.all([
    transactions.monthSummary(caller, accountId),
    budgets.listBudgets(caller, accountId),
    transactions.latestTransactions(caller, accountId, LATEST),
  ]);
  const t = await getTranslations("app.home");

  return (
    <>
      {summary.ok && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm opacity-70">{t("available")}</h2>
          <p className={`text-4xl font-semibold tabular-nums ${summary.availableCents < 0 ? "text-error" : ""}`}>
            {formatEuro(summary.availableCents)}
          </p>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            {(
              [
                ["income", summary.incomeCents],
                ["expenses", summary.expenseCents],
                ["saving", summary.savingCents],
              ] as const
            ).map(([key, cents]) => (
              <div key={key}>
                <dt className="opacity-70">{t(key)}</dt>
                <dd className="tabular-nums">{formatEuro(cents)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {budgetList.ok && (
        <>
          <div className="divider my-0" />
          <BudgetSection accountId={accountId} month={budgetList.month} budgets={budgetList.budgets} readOnly />
          <Link href={`/accounts/${accountId}`} className="link link-hover self-end text-sm">
            {t("editBudgets")}
          </Link>
        </>
      )}
      {latest.ok && (
        <>
          <div className="divider my-0" />
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{t("latest")}</h2>
            <TransactionList transactions={latest.transactions} />
            <Link href={`/accounts/${accountId}`} className="btn btn-ghost btn-sm self-end">
              {t("allBookings")}
            </Link>
          </section>
        </>
      )}
    </>
  );
}
