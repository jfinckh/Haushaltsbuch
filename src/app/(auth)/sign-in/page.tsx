import type { Metadata } from "next";
import { SignInForm } from "@/auth";

export const metadata: Metadata = { title: "Anmelden · Haushaltsbuch" };

export default function Page() {
  return <SignInForm />;
}
