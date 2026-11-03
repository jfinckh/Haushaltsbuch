import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { recurring } from "@/app/_lib/recurring";
import { RecurringList, RecurringSuggestions } from "@/recurring";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

export default function RecurringPage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <Suspense fallback={<span className="loading loading-spinner" />}>
          <Recurring />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function Recurring() {
  const { caller } = await requireCaller("/sign-in");
  const visible = await accounts.listAccounts(caller);
  const archivedAccountIds = new Set(visible.filter((a) => a.archived).map((a) => a.id));
  const [templates, catalog, suggestions] = await Promise.all([
    recurring.listTemplates(caller, { archivedAccountIds }),
    categories.catalog(caller),
    recurring.listSuggestions(caller),
  ]);
  // New templates go to active accounts only, so suggestions from archived accounts are left out.
  const active = visible.filter((a) => !a.archived).map(({ id, name, visibility }) => ({ id, name, visibility }));
  const activeIds = new Set(active.map((a) => a.id));
  const t = await getTranslations("recurring.page");
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("intro")}
        actions={
          <Link href="/recurring/new" className="btn btn-primary btn-sm">
            {t("addTemplate")}
          </Link>
        }
      />
      <RecurringSuggestions suggestions={suggestions.filter((s) => activeIds.has(s.accountId))} accounts={active} categories={catalog} />
      <RecurringList templates={templates} accounts={visible.map(({ id, name }) => ({ id, name }))} categoryNames={catalog.names} />
    </>
  );
}
