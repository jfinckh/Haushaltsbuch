import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { TransactionForm } from "@/transactions";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function NewTransactionPage(props: Props) {
  return (
    <AppShell narrow>
      <div className="flex flex-col gap-6">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <NewTransaction {...props} />
          </Suspense>
        </div>
    </AppShell>
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
      <PageHeader title={t("addTitle")} back={{ href: accountId ? `/accounts/${accountId}` : "/", label: t("back") }} />
      {bookable.length === 0 ? <p className="opacity-70">{t("noAccounts")}</p> : <TransactionForm accounts={bookable} accountId={accountId} categories={catalog} />}
    </>
  );
}
