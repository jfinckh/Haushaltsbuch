import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CreateHouseholdForm } from "@/households";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";
import { PendingInvite } from "@/app/_lib/pending-invite";
import { AuthFrame } from "@/app/_lib/app-shell";

export default function NewHouseholdPage() {
  return (
    <AuthFrame>
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <NewHousehold />
      </Suspense>
    </AuthFrame>
  );
}

async function NewHousehold() {
  const { user, caller } = await requireCaller("/sign-in");
  if (await households.getMembership(caller)) redirect("/");
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <PendingInvite caller={caller} userId={user.id} />
      <CreateHouseholdForm redirectTo="/" />
    </div>
  );
}
