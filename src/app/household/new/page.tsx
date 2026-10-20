import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CreateHouseholdForm } from "@/households";
import { auth } from "@/app/_lib/auth";
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
  const { user } = await auth.requireSession("/sign-in");
  const inviter = await auth.getInviter(user.id);
  const { membership } = await households.joinInvitersHousehold(
    user.id,
    inviter && { inviterId: inviter.id, invitedAt: inviter.invitedAt },
  );
  if (membership) redirect("/");
  return <CreateHouseholdForm redirectTo="/" />;
}
