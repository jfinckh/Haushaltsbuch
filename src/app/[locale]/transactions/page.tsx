import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountSwitcher } from "@/app/_lib/account-switcher";
import { accounts } from "@/app/_lib/accounts";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";
import { sanitizeBookingsQuery } from "@/app/_lib/bookings-query";
import { requireCaller } from "@/app/_lib/caller";
import { categories } from "@/app/_lib/categories";
import { households } from "@/app/_lib/households";
import { transactions } from "@/app/_lib/transactions";
import { ALL_MINE, selectAccount } from "@/insights";
import { formatEuro } from "@/shared/money";
import { TransactionFilters, TransactionList } from "@/transactions";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const PAGE_SIZE = 200;
const MAX_LIMIT = 5000;

export default function TransactionsPage(props: Props) {
  return (
    <AppShell>
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Bookings {...props} />
      </Suspense>
    </AppShell>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The bookings of one visible account (?account=<id>) or of all own private accounts (?account=all),
 * filtered by period (month, year or range), kind, category and text.
 */
async function Bookings({ searchParams }: Props) {
  const { caller } = await requireCaller("/sign-in");
  if (!(await households.getHousehold(caller))) redirect("/household/new");
  const query = await searchParams;
  const visibleAccounts = await accounts.listAccounts(caller);
  const selected = selectAccount(visibleAccounts, first(query.account));
  const t = await getTranslations("app.transactions");

  if (!selected) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} />
        <p className="opacity-70">{t("noAccounts")}</p>
      </div>
    );
  }

  const selectedId = selected === ALL_MINE ? ALL_MINE : selected.id;
  const catalog = await categories.catalog(caller);
  // A shared account never offers personal categories.
  const groups = selected !== ALL_MINE && selected.visibility === "shared" ? catalog.shared : catalog.private;

  const sharedAccount = selected !== ALL_MINE && selected.visibility === "shared";
  const { values: kept, limit } = sanitizeBookingsQuery(query, { catalog, sharedAccount });

  const target = selected === ALL_MINE ? ({ scope: "own-private" } as const) : { accountId: selected.id };
  const listed = await transactions.listTransactions(caller, { ...target, ...kept, limit });
  const accountNames =
    selected === ALL_MINE ? Object.fromEntries(visibleAccounts.filter((a) => a.visibility === "private").map((a) => [a.id, a.name])) : undefined;

  const more = listed.ok && limit < MAX_LIMIT && listed.total.count > listed.transactions.length;
  const moreHref = `/transactions?${new URLSearchParams({ account: selectedId, ...kept, limit: String(Math.min(limit + PAGE_SIZE, MAX_LIMIT)) })}`;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={t("title")} />
      <AccountSwitcher accounts={visibleAccounts} selectedId={selectedId} path="/transactions" params={kept} />
      <TransactionFilters key={new URLSearchParams({ account: selectedId, ...kept }).toString()} values={kept} periods params={{ account: selectedId }} categoryGroups={groups} categoryNames={catalog.names} />
      {listed.ok ? (
        <>
          <p className="text-sm text-base-content/70">{t("count", { count: listed.total.count, sum: formatEuro(listed.total.sumCents) })}</p>
          <TransactionList transactions={listed.transactions} accountNames={accountNames} categoryNames={catalog.names} />
          {more && (
            <Link href={moreHref} className="btn btn-sm self-center">
              {t("loadMore")}
            </Link>
          )}
        </>
      ) : (
        <div role="alert" className="alert alert-warning alert-soft">
          <span>{t("invalidPeriod")}</span>
        </div>
      )}
    </div>
  );
}
