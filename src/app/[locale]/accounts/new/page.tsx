import { useTranslations } from "next-intl";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AccountForm } from "@/accounts";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { AppShell, PageHeader } from "@/app/_lib/app-shell";

export default function NewAccountPage() {
  const t = useTranslations("app.accounts");
  return (
    <AppShell narrow>
      <div className="flex flex-col gap-6">
          <PageHeader title={t("addTitle")} back={{ href: "/household", label: t("back") }} />
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <NewAccount />
          </Suspense>
        </div>
    </AppShell>
  );
}

async function NewAccount() {
  const { caller } = await requireCaller("/sign-in");
  if (!(await households.getMembership(caller))) redirect("/household/new");
  return <AccountForm />;
}
