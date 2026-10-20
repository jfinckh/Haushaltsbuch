import { Suspense } from "react";
import { InviteShareButton, SignOutButton } from "@/auth";
import { auth } from "@/app/_lib/auth";

export default function Home() {
  return (
    <main className="flex flex-1 items-start justify-center p-4 sm:items-center">
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Welcome />
      </Suspense>
    </main>
  );
}

async function Welcome() {
  const { user } = await auth.requireSession("/sign-in");
  const inviter = await auth.getInviter(user.id);

  return (
    <div className="card bg-base-100 w-full max-w-md shadow-md">
      <div className="card-body gap-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="card-title text-2xl">Hello, {user.name}</h1>
          <SignOutButton redirectTo="/sign-in" />
        </div>
        {inviter && <p className="opacity-70">Invited by {inviter.name}</p>}
        <div className="divider my-0" />
        <h2 className="font-semibold">Invite your partner</h2>
        <InviteShareButton shareText="Join our Haushaltsbuch:" />
      </div>
    </div>
  );
}
