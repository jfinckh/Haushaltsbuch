import type { Metadata } from "next";
import { SignUpForm } from "@/auth";

export const metadata: Metadata = { title: "Registrieren · Haushaltsbuch" };

export default function Page() {
  return <SignUpForm />;
}
