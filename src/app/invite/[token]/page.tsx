import { Suspense } from "react";
import { InviteAcceptance } from "@/auth";

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Invite params={params} />
      </Suspense>
    </main>
  );
}

async function Invite({ params }: Pick<PageProps<"/invite/[token]">, "params">) {
  const { token } = await params;
  return <InviteAcceptance token={token} signInHref="/sign-in" signUpHref="/sign-up" continueHref="/" />;
}
