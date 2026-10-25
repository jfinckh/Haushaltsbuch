import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { RuleForm } from "@/rules";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

export default function NewRulePage() {
  return (
    <AppShell narrow>
      <div className="flex flex-col gap-6">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <NewRule />
          </Suspense>
        </div>
    </AppShell>
  );
}

async function NewRule() {
  const { caller } = await requireCaller("/sign-in");
  const [listed, catalog] = await Promise.all([accounts.listAccounts(caller), categories.catalog(caller)]);
  const visible = listed.filter((a) => !a.archived).map(({ id, name, visibility, iban }) => ({ id, name, visibility, iban }));
  const t = await getTranslations("app.rules");
  return (
    <>
      <PageHeader title={t("newTitle")} back={{ href: "/rules", label: t("back") }} />
      <RuleForm accounts={visible} categories={catalog} />
    </>
  );
}
