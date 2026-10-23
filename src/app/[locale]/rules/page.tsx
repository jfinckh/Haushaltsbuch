import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { rules } from "@/app/_lib/rules";
import { ApplyRulesForm, RuleList } from "@/rules";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

export default function RulesPage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <Rules />
          </Suspense>
        </div>
    </AppShell>
  );
}

async function Rules() {
  const { caller } = await requireCaller("/sign-in");
  const [visible, list, catalog] = await Promise.all([accounts.listAccounts(caller), rules.listRules(caller), categories.catalog(caller)]);
  const named = visible.map(({ id, name }) => ({ id, name }));
  const active = visible.filter((a) => !a.archived).map(({ id, name }) => ({ id, name }));
  const t = await getTranslations("app.rules");
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("intro")}
        actions={
          <Link href="/rules/new" className="btn btn-primary btn-sm">
            {t("add")}
          </Link>
        }
      />
      <RuleList rules={list} accounts={named} categoryNames={catalog.names} />
      {active.length > 0 && (
        <>
          <hr className="border-base-300" />
          <ApplyRulesForm accounts={active} />
        </>
      )}
    </>
  );
}
