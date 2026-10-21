import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountActions, AccountForm } from "@/accounts";
import { accounts } from "@/app/_lib/accounts";
import { requireCaller } from "@/app/_lib/caller";

type Params = { params: Promise<{ id: string }> };

export default function EditAccountPage({ params }: Params) {
  return (
    <main className="flex flex-1 items-start justify-center p-4 sm:items-center">
      <div className="card bg-base-100 w-full max-w-md shadow-md">
        <div className="card-body gap-4">
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <EditAccount params={params} />
          </Suspense>
        </div>
      </div>
    </main>
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
      <div className="flex items-center justify-between gap-2">
        <h1 className="card-title text-2xl">{t("editTitle")}</h1>
        <Link href={`/accounts/${account.id}`} className="btn btn-ghost btn-sm">
          {t("back")}
        </Link>
      </div>
      {account.archived && (
        <div role="status" className="alert alert-soft">
          <span>{t("archived")}</span>
        </div>
      )}
      <AccountForm account={account} redirectTo={`/accounts/${account.id}`} />
      <div className="divider my-0" />
      <AccountActions id={account.id} archived={account.archived} shared={account.visibility === "shared"} />
    </>
  );
}
