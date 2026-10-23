import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { accounts } from "@/app/_lib/accounts";
import { categories } from "@/app/_lib/categories";
import { requireCaller } from "@/app/_lib/caller";
import { RuleForm } from "@/rules";

export default function NewRulePage() {
  return (
    <main className="flex flex-1 items-start justify-center p-4 sm:items-center">
      <div className="card bg-base-100 w-full max-w-md shadow-md">
        <div className="card-body gap-4">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <NewRule />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function NewRule() {
  const { caller } = await requireCaller("/sign-in");
  const [listed, catalog] = await Promise.all([accounts.listAccounts(caller), categories.catalog(caller)]);
  const visible = listed.filter((a) => !a.archived).map(({ id, name, visibility }) => ({ id, name, visibility }));
  const t = await getTranslations("app.rules");
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="card-title text-2xl">{t("newTitle")}</h1>
        <Link href="/rules" className="btn btn-ghost btn-sm">
          {t("back")}
        </Link>
      </div>
      <RuleForm accounts={visible} categories={catalog} />
    </>
  );
}
