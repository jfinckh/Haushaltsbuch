import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { currentBalances } from "@/app/_lib/balances";
import { budgets } from "@/app/_lib/budgets";
import { requireCaller } from "@/app/_lib/caller";
import { transactions } from "@/app/_lib/transactions";
import { householdMembers, transfers } from "@/app/_lib/transfers";
import { BudgetSection } from "@/budgets";
import { formatEuro } from "@/shared/money";
import { TransactionFilters, TransactionList } from "@/transactions";
import { TransferInbox } from "@/transfers";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function AccountPage(props: Props) {
  return (
    <main className="flex flex-1 items-start justify-center p-4">
      <div className="card bg-base-100 w-full max-w-md shadow-md">
        <div className="card-body gap-4">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <AccountBookings {...props} />
          </Suspense>
        </div>
      </div>
    </main>
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
  const [listed, budgetList, sums, transferOverview, visible] = await Promise.all([
    transactions.listTransactions(caller, { accountId: id, ...filters }),
    budgets.listBudgets(caller, id, filters.month || undefined),
    transactions.balances(caller),
    householdMembers(caller).then((members) => transfers.accountOverview(caller, id, members)),
    accounts.listAccounts(caller),
  ]);
  if (!listed.ok && listed.reason === "not-found") notFound();
  const balance = currentBalances([account], sums)[account.id];
  const t = await getTranslations("app.accounts");

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="card-title truncate text-2xl">{account.name}</h1>
        <Link href={`/?account=${account.id}`} className="btn btn-ghost btn-sm">
          {t("back")}
        </Link>
      </div>
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
          <div className="divider my-0" />
          <BudgetSection accountId={account.id} month={budgetList.month} budgets={budgetList.budgets} />
        </>
      )}
      <div className="divider my-0" />
      <TransactionFilters values={filters} />
      {listed.ok ? (
        <TransactionList transactions={listed.transactions} />
      ) : (
        <div role="alert" className="alert alert-warning alert-soft">
          <span>{t("invalidFilter")}</span>
        </div>
      )}
    </>
  );
}
