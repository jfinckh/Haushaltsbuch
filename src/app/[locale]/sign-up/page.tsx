import { SignUpForm } from "@/auth";

export default function SignUpPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <SignUpForm redirectTo="/" signInHref="/sign-in" />
    </main>
  );
}
