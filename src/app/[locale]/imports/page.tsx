import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ImportList, ImportUpload } from "@/import";
import { accounts } from "@/app/_lib/accounts";
import { requireCaller } from "@/app/_lib/caller";
import { imports } from "@/app/_lib/imports";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function ImportsPage(props: Props) {
  return (
    <main className="flex flex-1 items-start justify-center p-4">
      <div className="card bg-base-100 w-full max-w-3xl shadow-md">
        <div className="card-body gap-4">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <Imports {...props} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function Imports({ searchParams }: Props) {
  const { caller } = await requireCaller("/sign-in");
  const requested = (await searchParams).accountId;
  const visible = await accounts.listAccounts(caller);
  // Only bank accounts that are in use can take an import; cash has no export.
  const importable = visible.filter((a) => !a.archived && a.bank !== "cash").map(({ id, name }) => ({ id, name }));
  // Only an account the caller may see is preselected.
  const accountId = importable.find((a) => a.id === requested)?.id;
  const past = await imports.listImports(caller);
  const accountNames = Object.fromEntries(visible.map((a) => [a.id, a.name]));
  const t = await getTranslations("app.imports");
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="card-title text-2xl">{t("title")}</h1>
        <Link href={accountId ? `/accounts/${accountId}` : "/"} className="btn btn-ghost btn-sm">
          {t("back")}
        </Link>
      </div>
      <ImportUpload accounts={importable} accountId={accountId} />
      <div className="divider my-0" />
      <h2 className="font-semibold">{t("past")}</h2>
      <ImportList imports={past} accountNames={accountNames} />
    </>
  );
}
