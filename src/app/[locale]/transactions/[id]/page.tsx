import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { transactions } from "@/app/_lib/transactions";
import { householdMembers, transfers } from "@/app/_lib/transfers";
import { DeleteTransactionButton, TransactionForm } from "@/transactions";
import { TransferPanel } from "@/transfers";

type Params = { params: Promise<{ id: string }> };

export default function TransactionPage({ params }: Params) {
  return (
    <main className="flex flex-1 items-start justify-center p-4 sm:items-center">
      <div className="card bg-base-100 w-full max-w-md shadow-md">
        <div className="card-body gap-4">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <EditTransaction params={params} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function EditTransaction({ params }: Params) {
  const { caller } = await requireCaller("/sign-in");
  // A booking of another member's private account does not exist for this caller.
  const transaction = await transactions.getTransaction(caller, (await params).id);
  if (!transaction) notFound();
  const [visible, transferStatus, catalog] = await Promise.all([
    accounts.listAccounts(caller),
    householdMembers(caller).then((members) => transfers.statusOf(caller, transaction.id, members)),
    categories.catalog(caller),
  ]);
  // Active accounts, plus the booking's own account even if it is archived.
  const bookable = visible
    .filter((a) => !a.archived || a.id === transaction.accountId)
    .map(({ id, name, visibility }) => ({ id, name, visibility }));
  const t = await getTranslations("app.transactions");
  const accountHref = `/accounts/${transaction.accountId}`;
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="card-title text-2xl">{t("editTitle")}</h1>
        <Link href={accountHref} className="btn btn-ghost btn-sm">
          {t("back")}
        </Link>
      </div>
      <TransactionForm accounts={bookable} transaction={transaction} categories={catalog} offerRule />
      {transferStatus && (
        <>
          <div className="divider my-0" />
          <TransferPanel
            status={transferStatus}
            accounts={visible.filter((a) => !a.archived || a.id === transaction.accountId).map(({ id, name }) => ({ id, name }))}
            offerRule
          />
        </>
      )}
      <div className="divider my-0" />
      <DeleteTransactionButton id={transaction.id} redirectTo={accountHref} />
    </>
  );
}
