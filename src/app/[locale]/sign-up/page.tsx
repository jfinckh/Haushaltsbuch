import { Suspense } from "react";
import { SignUpForm } from "@/auth";
import { inviteReturn } from "@/app/_lib/invite-return";
import { AuthFrame } from "@/app/_lib/app-shell";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function SignUpPage({ searchParams }: Props) {
  return (
    <AuthFrame>
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <SignUp searchParams={searchParams} />
      </Suspense>
    </AuthFrame>
  );
}

/** From an invite link (?invite=…), signing up leads back to the invite page to accept it. */
async function SignUp({ searchParams }: Props) {
  const { redirectTo, signInHref } = inviteReturn((await searchParams).invite);
  return <SignUpForm redirectTo={redirectTo} signInHref={signInHref} />;
}
