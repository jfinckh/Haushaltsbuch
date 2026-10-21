import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AccountForm } from "@/accounts";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";

export default function NewAccountPage() {
  return (
    <main className="flex flex-1 items-start justify-center p-4 sm:items-center">
      <div className="card bg-base-100 w-full max-w-md shadow-md">
        <div className="card-body gap-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="card-title text-2xl">Add account</h1>
            <Link href="/" className="btn btn-ghost btn-sm">
              Back
            </Link>
          </div>
          <Suspense fallback={<span className="loading loading-spinner" />}>
            <NewAccount />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function NewAccount() {
  const { caller } = await requireCaller("/sign-in");
  if (!(await households.getMembership(caller))) redirect("/household/new");
  return <AccountForm />;
}
