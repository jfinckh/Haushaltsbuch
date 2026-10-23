import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { rules } from "@/app/_lib/rules";
import { RuleForm } from "@/rules";

type Params = { params: Promise<{ id: string }> };

export default function EditRulePage({ params }: Params) {
  return (
    <main className="flex flex-1 items-start justify-center p-4 sm:items-center">
      <div className="card bg-base-100 w-full max-w-md shadow-md">
        <div className="card-body gap-4">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <EditRule params={params} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function EditRule({ params }: Params) {
  const { caller } = await requireCaller("/sign-in");
  // A rule of another member's private account or scope does not exist for this caller.
  const rule = await rules.getRule(caller, (await params).id);
  if (!rule) notFound();
  const [visible, catalog] = await Promise.all([accounts.listAccounts(caller), categories.catalog(caller)]);
  // Active accounts, plus the rule's own account even if it is archived.
  const options = visible
    .filter((a) => !a.archived || (rule.scope.type === "account" && a.id === rule.scope.accountId))
    .map(({ id, name, visibility }) => ({ id, name, visibility }));
  const t = await getTranslations("app.rules");
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="card-title text-2xl">{t("editTitle")}</h1>
        <Link href="/rules" className="btn btn-ghost btn-sm">
          {t("back")}
        </Link>
      </div>
      <RuleForm accounts={options} rule={rule} categories={catalog} />
    </>
  );
}
