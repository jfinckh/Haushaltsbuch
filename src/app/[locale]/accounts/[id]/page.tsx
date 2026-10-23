import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { budgets } from "@/app/_lib/budgets";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { insights } from "@/app/_lib/insights";
import { transactions } from "@/app/_lib/transactions";
import { householdMembers, transfers } from "@/app/_lib/transfers";
import { BudgetSection } from "@/budgets";
import { formatEuro } from "@/shared/money";
import { TransactionFilters, TransactionList } from "@/transactions";
import { TransferInbox } from "@/transfers";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function AccountPage(props: Props) {
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <AccountBookings {...props} />
          </Suspense>
        </div>
    </AppShell>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function AccountBookings({ params, searchParams }: Props) {
  const { caller } = await requireCaller("/sign-in");
  const { id } = await params;
  // Another member's private account does not exist for this caller: same 404 as an unknown id.
  const account = await accounts.getAccount(caller, id);
  if (!account) notFound();
  const query = await searchParams;
  const filters = { month: first(query.month), kind: first(query.kind), category: first(query.category), q: first(query.q) };
  const [listed, budgetList, balances, transferOverview, visible, catalog] = await Promise.all([
    transactions.listTransactions(caller, { accountId: id, ...filters }),
    budgets.listBudgets(caller, id, filters.month || undefined),
    insights.balances(caller, [account]),
    householdMembers(caller).then((members) => transfers.accountOverview(caller, id, members)),
    accounts.listAccounts(caller),
    categories.catalog(caller),
  ]);
  if (!listed.ok && listed.reason === "not-found") notFound();
  // A shared account never offers personal categories.
  const groups = account.visibility === "shared" ? catalog.shared : catalog.private;
  const balance = balances[account.id];
  const t = await getTranslations("app.accounts");

  return (
    <>
      <PageHeader title={account.name} back={{ href: `/?account=${account.id}`, label: t("back") }} />
      {account.archived && (
        <div role="status" className="alert alert-soft">
          <span>{t("archived")}</span>
        </div>
      )}
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-sm opacity-70">{t("balance")}</p>
          <p className={`text-3xl font-semibold tabular-nums ${balance < 0 ? "text-error" : ""}`}>{formatEuro(balance)}</p>
        </div>
        <Link href={`/accounts/${account.id}/edit`} className="btn btn-ghost btn-sm">
          {t("edit")}
        </Link>
      </div>
      <div className="flex gap-2">
        <Link href={`/transactions/new?accountId=${account.id}`} className="btn btn-primary flex-1">
          {t("addBooking")}
        </Link>
        {account.bank !== "cash" && (
          <Link href={`/imports?accountId=${account.id}`} className="btn btn-outline flex-1">
            {t("importCsv")}
          </Link>
        )}
      </div>
      {transferOverview && (
        <TransferInbox
          overview={transferOverview}
          accounts={visible.map(({ id, name }) => ({ id, name }))}
        />
      )}
      {budgetList.ok && (
        <>
          <hr className="border-base-300" />
          <BudgetSection
            accountId={account.id}
            month={budgetList.month}
            budgets={budgetList.budgets}
            categoryGroups={groups}
            categoryNames={catalog.names}
          />
        </>
      )}
      <hr className="border-base-300" />
      <TransactionFilters values={filters} categoryGroups={groups} categoryNames={catalog.names} />
      {listed.ok ? (
        <TransactionList transactions={listed.transactions} categoryNames={catalog.names} />
      ) : (
        <div role="alert" className="alert alert-warning alert-soft">
          <span>{t("invalidFilter")}</span>
        </div>
      )}
    </>
  );
}
