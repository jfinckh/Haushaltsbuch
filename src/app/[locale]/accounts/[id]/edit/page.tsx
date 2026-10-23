import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountActions, AccountForm } from "@/accounts";
import { accounts } from "@/app/_lib/accounts";
import { requireCaller } from "@/app/_lib/caller";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

type Params = { params: Promise<{ id: string }> };

export default function EditAccountPage({ params }: Params) {
  return (
    <AppShell narrow>
      <div className="flex flex-col gap-6">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <EditAccount params={params} />
          </Suspense>
        </div>
    </AppShell>
  );
}

async function EditAccount({ params }: Params) {
  const { caller } = await requireCaller("/sign-in");
  // Another member's private account does not exist for this caller: same 404 as an unknown id.
  const account = await accounts.getAccount(caller, (await params).id);
  if (!account) notFound();
  const t = await getTranslations("app.accounts");
  return (
    <>
      <PageHeader title={t("editTitle")} back={{ href: `/accounts/${account.id}`, label: t("back") }} />
      {account.archived && (
        <div role="status" className="alert alert-soft">
          <span>{t("archived")}</span>
        </div>
      )}
      <AccountForm account={account} redirectTo={`/accounts/${account.id}`} />
      <hr className="border-base-300" />
      <AccountActions id={account.id} archived={account.archived} shared={account.visibility === "shared"} />
    </>
  );
}
