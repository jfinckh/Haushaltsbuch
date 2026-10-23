import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireCaller } from "@/app/_lib/caller";
import { categories } from "@/app/_lib/categories";
import { CategoryManager } from "@/transactions";

export default function CategoriesPage() {
  return (
    <main className="flex flex-1 items-start justify-center p-4">
      <div className="card bg-base-100 w-full max-w-2xl shadow-md">
        <div className="card-body gap-4">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <Categories />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

/** The caller's household and personal categories. Personal ones are only ever the caller's own. */
async function Categories() {
  const { caller } = await requireCaller("/sign-in");
  const { household, personal } = await categories.listCategories(caller);
  const t = await getTranslations("app.categories");
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="card-title text-2xl">{t("title")}</h1>
        <Link href="/household" className="btn btn-ghost btn-sm">
          {t("back")}
        </Link>
      </div>
      <p className="text-base-content/70 text-sm">{t("intro")}</p>
      <CategoryManager household={household} personal={personal} />
    </>
  );
}
