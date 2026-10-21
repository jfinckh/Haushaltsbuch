import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CreateHouseholdForm } from "@/households";
import { auth } from "@/app/_lib/auth";
import { requireCaller } from "@/app/_lib/caller";
import { households } from "@/app/_lib/households";

export default function NewHouseholdPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <NewHousehold />
      </Suspense>
    </main>
  );
}

async function NewHousehold() {
  const { user, caller } = await requireCaller("/sign-in");
  const inviter = await auth.getInviter(user.id);
  const { membership } = await households.joinInvitersHousehold(
    caller,
    inviter && { inviterId: inviter.id, invitedAt: inviter.invitedAt },
  );
  if (membership) redirect("/");
  return <CreateHouseholdForm redirectTo="/" />;
}
