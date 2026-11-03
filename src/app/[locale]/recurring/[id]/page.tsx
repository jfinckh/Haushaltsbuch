import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { recurring } from "@/app/_lib/recurring";
import { TemplateForm } from "@/recurring";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

type Params = { params: Promise<{ id: string }> };

export default function EditTemplatePage({ params }: Params) {
  return (
    <AppShell narrow>
      <div className="flex flex-col gap-6">
        <Suspense fallback={<span className="loading loading-spinner" />}>
          <EditTemplate params={params} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function EditTemplate({ params }: Params) {
  const { caller } = await requireCaller("/sign-in");
  // A template on another member's private account does not exist for this caller.
  const template = await recurring.getTemplate(caller, (await params).id);
  if (!template) notFound();
  const [visible, catalog] = await Promise.all([accounts.listAccounts(caller), categories.catalog(caller)]);
  // Active accounts, plus the template's own account even if it is archived.
  const usable = visible
    .filter((a) => !a.archived || a.id === template.accountId)
    .map(({ id, name, visibility }) => ({ id, name, visibility }));
  const t = await getTranslations("recurring.page");
  return (
    <>
      <PageHeader title={t("editTitle")} back={{ href: "/recurring", label: t("back") }} />
      <TemplateForm accounts={usable} categories={catalog} template={template} />
    </>
  );
}
