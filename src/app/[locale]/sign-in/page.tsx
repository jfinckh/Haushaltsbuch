import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DevSignIn } from "@/auth";
import { auth } from "@/app/_lib/auth";
import { inviteReturn } from "@/app/_lib/invite-return";
import { AuthFrame } from "@/app/_lib/app-shell";
import { SEED_USERS } from "@/app/_lib/seed";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// The one door into the app. With the zero-trust provider (identity mode) the person is signed in
// there already: this page only hands over to the endpoint that starts the session. Locally (dev
// mode) it shows the dev sign-in.
export default function SignInPage({ searchParams }: Props) {
  return (
    <AuthFrame>
      <Suspense fallback={<span className="loading loading-spinner" />}>
        <SignIn searchParams={searchParams} />
      </Suspense>
    </AuthFrame>
  );
}

/** From an invite link (?invite=…), signing in leads back to the invite page to accept it. */
async function SignIn({ searchParams }: Props) {
  const params = await searchParams;
  const { redirectTo } = inviteReturn(params.invite);

  if (auth.mode === "identity") {
    // After sign-out the provider's login must end too, or the next request signs in again at once.
    if (params.signedOut) redirect(auth.signOutRedirect);
    redirect(auth.signInUrl(redirectTo));
  }

  async function signIn(_state: { failed: boolean }, form: FormData) {
    "use server";
    const email = form.get("email");
    const name = form.get("name");
    try {
      await auth.devSignIn({
        email: typeof email === "string" ? email : "",
        name: typeof name === "string" && name.trim() ? name : undefined,
      });
    } catch {
      return { failed: true };
    }
    redirect(redirectTo);
  }

  return <DevSignIn users={Object.values(SEED_USERS)} action={signIn} />;
}
