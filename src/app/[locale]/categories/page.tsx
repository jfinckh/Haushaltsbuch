import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireCaller } from "@/app/_lib/caller";
import { categories } from "@/app/_lib/categories";
import { CategoryManager } from "@/transactions";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

export default function CategoriesPage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <Categories />
          </Suspense>
        </div>
    </AppShell>
  );
}

/** The caller's household and personal categories. Personal ones are only ever the caller's own. */
async function Categories() {
  const { caller } = await requireCaller("/sign-in");
  const { household, personal } = await categories.listCategories(caller);
  const t = await getTranslations("app.categories");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("intro")} />
      <CategoryManager household={household} personal={personal} />
    </>
  );
}
