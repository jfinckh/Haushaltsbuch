import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { rules } from "@/app/_lib/rules";
import { RuleForm } from "@/rules";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

type Params = { params: Promise<{ id: string }> };

export default function EditRulePage({ params }: Params) {
  return (
    <AppShell narrow>
      <div className="flex flex-col gap-6">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <EditRule params={params} />
          </Suspense>
        </div>
    </AppShell>
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
      <PageHeader title={t("editTitle")} back={{ href: "/rules", label: t("back") }} />
      <RuleForm accounts={options} rule={rule} categories={catalog} />
    </>
  );
}
