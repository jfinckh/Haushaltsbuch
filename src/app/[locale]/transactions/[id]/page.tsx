import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { safeBack } from "@/app/_lib/back-link";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { transactions } from "@/app/_lib/transactions";
import { householdMembers, transfers } from "@/app/_lib/transfers";
import { DeleteTransactionButton, TransactionForm } from "@/transactions";
import { TransferPanel } from "@/transfers";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string | string[] }>;
};

export default function TransactionPage({ params, searchParams }: Params) {
  return (
    <AppShell narrow>
      <div className="flex flex-col gap-6">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <EditTransaction params={params} searchParams={searchParams} />
          </Suspense>
        </div>
    </AppShell>
  );
}

async function EditTransaction({ params, searchParams }: Params) {
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
  // Back to the list the booking was opened from, if the address is one of the app's own.
  const back = safeBack((await searchParams).back);
  return (
    <>
      <PageHeader title={t("editTitle")} back={{ href: back ?? accountHref, label: t("back") }} />
      <TransactionForm accounts={bookable} transaction={transaction} categories={catalog} offerRule returnTo={back ?? undefined} />
      {transferStatus && (
        <>
          <hr className="border-base-300" />
          <TransferPanel
            status={transferStatus}
            accounts={visible.filter((a) => !a.archived || a.id === transaction.accountId).map(({ id, name }) => ({ id, name }))}
            offerRule
          />
        </>
      )}
      <hr className="border-base-300" />
      <DeleteTransactionButton id={transaction.id} redirectTo={back ?? accountHref} />
    </>
  );
}
