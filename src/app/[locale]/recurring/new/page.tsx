import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { TemplateForm } from "@/recurring";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

export default function NewTemplatePage() {
  return (
    <AppShell narrow>
      <div className="flex flex-col gap-6">
        <Suspense fallback={<span className="loading loading-spinner" />}>
          <NewTemplate />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function NewTemplate() {
  const { caller } = await requireCaller("/sign-in");
  const [visible, catalog] = await Promise.all([accounts.listAccounts(caller), categories.catalog(caller)]);
  const usable = visible.filter((a) => !a.archived).map(({ id, name, visibility }) => ({ id, name, visibility }));
  const t = await getTranslations("recurring.page");
  const tApp = await getTranslations("app.transactions");
  return (
    <>
      <PageHeader title={t("newTitle")} back={{ href: "/recurring", label: t("back") }} />
      {usable.length === 0 ? <p className="opacity-70">{tApp("noAccounts")}</p> : <TemplateForm accounts={usable} categories={catalog} />}
    </>
  );
}
