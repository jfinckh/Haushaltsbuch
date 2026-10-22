import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { requireCaller } from "@/app/_lib/caller";
import { rules } from "@/app/_lib/rules";
import { ApplyRulesForm, RuleList } from "@/rules";

export default function RulesPage() {
  return (
    <main className="flex flex-1 items-start justify-center p-4">
      <div className="card bg-base-100 w-full max-w-3xl shadow-md">
        <div className="card-body gap-4">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <Rules />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function Rules() {
  const { caller } = await requireCaller("/sign-in");
  const [visible, list] = await Promise.all([accounts.listAccounts(caller), rules.listRules(caller)]);
  const named = visible.map(({ id, name }) => ({ id, name }));
  const active = visible.filter((a) => !a.archived).map(({ id, name }) => ({ id, name }));
  const t = await getTranslations("app.rules");
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="card-title text-2xl">{t("title")}</h1>
        <div className="flex gap-2">
          <Link href="/" className="btn btn-ghost btn-sm">
            {t("back")}
          </Link>
          <Link href="/rules/new" className="btn btn-primary btn-sm">
            {t("add")}
          </Link>
        </div>
      </div>
      <p className="text-base-content/70 text-sm">{t("intro")}</p>
      <RuleList rules={list} accounts={named} />
      {active.length > 0 && (
        <>
          <div className="divider my-0" />
          <ApplyRulesForm accounts={active} />
        </>
      )}
    </>
  );
}
