import { Suspense } from "react";
import { SignUpForm } from "@/auth";
import { inviteReturn } from "@/app/_lib/invite-return";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function SignUpPage({ searchParams }: Props) {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <SignUp searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** From an invite link (?invite=…), signing up leads back to the invite page to accept it. */
async function SignUp({ searchParams }: Props) {
  const { redirectTo, signInHref } = inviteReturn((await searchParams).invite);
  return <SignUpForm redirectTo={redirectTo} signInHref={signInHref} />;
}
