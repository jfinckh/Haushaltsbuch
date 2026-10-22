import { Suspense } from "react";
import { SignInForm } from "@/auth";
import { inviteReturn } from "@/app/_lib/invite-return";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function SignInPage({ searchParams }: Props) {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <SignIn searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** From an invite link (?invite=…), signing in leads back to the invite page to accept it. */
async function SignIn({ searchParams }: Props) {
  const { redirectTo, signUpHref } = inviteReturn((await searchParams).invite);
  return <SignInForm redirectTo={redirectTo} signUpHref={signUpHref} />;
}
