import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { BudgetSection } from "@/budgets";
import { AccountSwitcher } from "@/app/_lib/account-switcher";
import { bookingsHref } from "@/app/_lib/bookings-href";
import { accounts } from "@/app/_lib/accounts";
import { auth } from "@/app/_lib/auth";
import { budgets } from "@/app/_lib/budgets";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { insights } from "@/app/_lib/insights";
import { transactions } from "@/app/_lib/transactions";
import { AppShell, PageHeader, Section } from "@/app/_lib/app-shell";
import { ALL_MINE, selectAccount } from "@/insights";
import { formatEuro } from "@/shared/money";
import type { Caller } from "@/shared/rls";
import { CategorySpending, TransactionList } from "@/transactions";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** How many of the newest bookings the dashboard shows. */
const LATEST = 8;

export default function Home(props: Props) {
  return (
    <AppShell>
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Dashboard {...props} />
      </Suspense>
    </AppShell>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * One account at a time (?account=<id>), or all own private accounts together (?account=all):
 * available this month, budgets (single account only), spending by category, newest bookings.
 */
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
  const selectedId = selected === ALL_MINE ? ALL_MINE : (selected?.id ?? "");
  const t = await getTranslations("app.home");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("greeting", { name: user.name })}
        actions={
          selected && (
            <Link href={`/statistics?account=${selectedId}`} className="btn btn-ghost btn-sm">
              {t("statistics")}
            </Link>
          )
        }
      />
      <div className="flex flex-col gap-6">
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
            <AccountSwitcher accounts={visibleAccounts} selectedId={selectedId} path="/" />
            {selected === ALL_MINE ? (
              <CombinedDashboard
                caller={caller}
                accountNames={Object.fromEntries(visibleAccounts.filter((a) => a.visibility === "private").map((a) => [a.id, a.name]))}
              />
            ) : (
              <AccountDashboard caller={caller} accountId={selected.id} />
            )}
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
  const [summary, budgetList, spending, latest, { names }] = await Promise.all([
    insights.monthFigures(caller, accountId),
    budgets.listBudgets(caller, accountId),
    transactions.categorySpending(caller, accountId),
    transactions.latestTransactions(caller, accountId, LATEST),
    categories.catalog(caller),
  ]);
  const t = await getTranslations("app.home");

  return (
    <DashboardColumns
      main={
        <>
          {summary.ok && (
            <MonthFigures
              availableCents={summary.availableCents}
              month={summary.month}
              account={accountId}
              figures={[
                ["income", summary.incomeCents],
                ["expenses", summary.expenseCents],
                ["saving", summary.savingCents],
              ]}
            />
          )}
          {budgetList.ok && (
            <Section>
              <BudgetSection accountId={accountId} month={budgetList.month} budgets={budgetList.budgets} readOnly categoryNames={names} />
              <Link href={`/accounts/${accountId}`} className="link link-hover self-start text-sm text-base-content/70">
                {t("editBudgets")}
              </Link>
            </Section>
          )}
          {spending.ok && (
            <Section>
              <CategorySpending account={accountId} month={spending.month} totalCents={spending.totalCents} groups={spending.groups} categoryNames={names} />
            </Section>
          )}
        </>
      }
      side={
        latest.ok && (
          <Section
            title={t("latest")}
            actions={
              <Link href={`/transactions?account=${accountId}`} className="link link-hover text-sm text-base-content/70">
                {t("allBookings")}
              </Link>
            }
          >
            <TransactionList transactions={latest.transactions} categoryNames={names} back={`/?account=${accountId}`} />
          </Section>
        )
      }
    />
  );
}

/** Figures and charts on the left, newest bookings on the right (stacked on phones). */
function DashboardColumns({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-10">
      <div className="flex min-w-0 flex-col gap-8">{main}</div>
      <div className="min-w-0">{side}</div>
    </div>
  );
}

type FigureKey = "income" | "expenses" | "saving" | "contribution";

/** The big available amount and the figures below it (cents, signed as booked). */
async function MonthFigures({
  availableCents,
  month,
  account,
  figures,
}: {
  availableCents: number;
  month: string;
  account: string;
  figures: [FigureKey, number][];
}) {
  const t = await getTranslations("app.home");
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-sm text-base-content/60">{t("available")}</h2>
        <p className={`mt-1 text-4xl font-semibold tracking-tight sm:text-5xl ${availableCents < 0 ? "text-error" : ""}`}>
          {formatEuro(availableCents)}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-box border border-base-300 bg-base-300 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
        {figures.map(([key, cents]) => {
          const kind = key === "income" ? "income" : key === "expenses" ? "expense" : key === "saving" ? "saving" : undefined;
          const href = kind && bookingsHref({ account, month, kind });
          // A linked tile's link sits in the value and stretches over the whole tile.
          return (
            <div key={key} className={`relative min-w-0 bg-base-100 px-4 py-3 ${href ? "transition-colors has-[a:hover]:bg-base-200" : ""}`}>
              <dt className="text-xs leading-snug text-base-content/60">{t(key)}</dt>
              <dd className="mt-0.5 font-medium">
                {href ? (
                  <Link href={href} className="before:absolute before:inset-0">
                    {formatEuro(cents)}
                  </Link>
                ) : (
                  formatEuro(cents)
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** The caller's own private accounts together. The contribution to shared accounts lowers what is available. */
async function CombinedDashboard({ caller, accountNames }: { caller: Caller; accountNames: Record<string, string> }) {
  const mine = { ownPrivate: true } as const;
  const [summary, spending, latest, { names }] = await Promise.all([
    insights.monthFigures(caller, mine),
    transactions.categorySpending(caller, mine),
    transactions.latestTransactions(caller, mine, LATEST),
    categories.catalog(caller),
  ]);
  const t = await getTranslations("app.home");

  return (
    <DashboardColumns
      main={
        <>
          {summary.ok && (
            <MonthFigures
              availableCents={summary.availableCents}
              month={summary.month}
              account={ALL_MINE}
              figures={[
                ["income", summary.incomeCents],
                ["expenses", summary.expenseCents],
                ["saving", summary.savingCents],
                ["contribution", summary.contributionCents ?? 0],
              ]}
            />
          )}
          {spending.ok && (
            <Section>
              <CategorySpending account={ALL_MINE} month={spending.month} totalCents={spending.totalCents} groups={spending.groups} categoryNames={names} />
            </Section>
          )}
        </>
      }
      side={
        latest.ok && (
          <Section
            title={t("latest")}
            actions={
              <Link href={`/transactions?account=${ALL_MINE}`} className="link link-hover text-sm text-base-content/70">
                {t("allBookings")}
              </Link>
            }
          >
            <TransactionList transactions={latest.transactions} accountNames={accountNames} categoryNames={names} back={`/?account=${ALL_MINE}`} />
          </Section>
        )
      }
    />
  );
}
