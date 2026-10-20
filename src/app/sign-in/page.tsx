import { SignInForm } from "@/auth";

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <SignInForm redirectTo="/" signUpHref="/sign-up" />
    </main>
  );
}
