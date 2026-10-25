import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { rules } from "@/app/_lib/rules";
import { ApplyRulesForm, RuleList, RuleSuggestions } from "@/rules";
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
  const [visible, list, catalog, suggestions] = await Promise.all([
    accounts.listAccounts(caller),
    rules.listRules(caller),
    categories.catalog(caller),
    rules.listSuggestions(caller),
  ]);
  const named = visible.map(({ id, name }) => ({ id, name }));
  const active = visible.filter((a) => !a.archived).map(({ id, name }) => ({ id, name }));
  const activeIds = new Set(active.map((a) => a.id));
  const forForm = visible.filter((a) => !a.archived).map(({ id, name, visibility, iban }) => ({ id, name, visibility, iban }));
  // A suggestion from an archived account is left out: new rules go to active accounts only.
  const open = suggestions.filter((s) => activeIds.has(s.accountId));
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
      <RuleSuggestions suggestions={open} accounts={forForm} categories={catalog} />
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
