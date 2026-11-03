import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { recurring } from "@/app/_lib/recurring";
import { RecurringList } from "@/recurring";
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
  const [templates, catalog] = await Promise.all([recurring.listTemplates(caller, { archivedAccountIds }), categories.catalog(caller)]);
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
      <RecurringList templates={templates} accounts={visible.map(({ id, name }) => ({ id, name }))} categoryNames={catalog.names} />
    </>
  );
}
