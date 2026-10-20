import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/auth";

export const metadata: Metadata = { title: "Passwort vergessen · Haushaltsbuch" };

export default function Page() {
  return <ForgotPasswordForm />;
}
