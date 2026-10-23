import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ImportList, ImportUpload } from "@/import";
import { accounts } from "@/app/_lib/accounts";
import { requireCaller } from "@/app/_lib/caller";
import { imports } from "@/app/_lib/imports";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function ImportsPage(props: Props) {
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <Imports {...props} />
          </Suspense>
        </div>
    </AppShell>
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
      <PageHeader title={t("title")} back={accountId ? { href: `/accounts/${accountId}`, label: t("back") } : undefined} />
      <ImportUpload accounts={importable} accountId={accountId} />
      <hr className="border-base-300" />
      <h2 className="font-semibold">{t("past")}</h2>
      <ImportList imports={past} accountNames={accountNames} />
    </>
  );
}
