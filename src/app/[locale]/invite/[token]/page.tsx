import { Suspense } from "react";
import { InviteAcceptance } from "@/auth";
import { inviteReturn } from "@/app/_lib/invite-return";
import { AuthFrame } from "@/app/_lib/app-shell";

export default function InvitePage({ params }: PageProps<"/[locale]/invite/[token]">) {
  return (
    <AuthFrame>
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <Invite params={params} />
      </Suspense>
    </AuthFrame>
  );
}

async function Invite({ params }: Pick<PageProps<"/[locale]/invite/[token]">, "params">) {
  const { token } = await params;
  // Signing in or up from here leads back to this page, where the user accepts the invite.
  const { signInHref, signUpHref } = inviteReturn(token);
  return <InviteAcceptance token={token} signInHref={signInHref} signUpHref={signUpHref} continueHref="/" />;
}
