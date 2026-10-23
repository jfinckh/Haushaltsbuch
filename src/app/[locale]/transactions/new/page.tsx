import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { TransactionForm } from "@/transactions";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function NewTransactionPage(props: Props) {
  return (
    <main className="flex flex-1 items-start justify-center p-4 sm:items-center">
      <div className="card bg-base-100 w-full max-w-md shadow-md">
        <div className="card-body gap-4">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <NewTransaction {...props} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function NewTransaction({ searchParams }: Props) {
  const { caller } = await requireCaller("/sign-in");
  const requested = (await searchParams).accountId;
  const [visible, catalog] = await Promise.all([accounts.listAccounts(caller), categories.catalog(caller)]);
  const bookable = visible.filter((a) => !a.archived).map(({ id, name, visibility }) => ({ id, name, visibility }));
  // Only an account the caller may see is preselected.
  const accountId = bookable.find((a) => a.id === requested)?.id;
  const t = await getTranslations("app.transactions");
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="card-title text-2xl">{t("addTitle")}</h1>
        <Link href={accountId ? `/accounts/${accountId}` : "/"} className="btn btn-ghost btn-sm">
          {t("back")}
        </Link>
      </div>
      {bookable.length === 0 ? <p className="opacity-70">{t("noAccounts")}</p> : <TransactionForm accounts={bookable} accountId={accountId} categories={catalog} />}
    </>
  );
}
