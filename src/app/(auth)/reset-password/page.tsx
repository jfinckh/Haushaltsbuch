import type { Metadata } from "next";
import { ResetPasswordForm } from "@/auth";

export const metadata: Metadata = { title: "Neues Passwort · Haushaltsbuch" };

export default function Page() {
  return <ResetPasswordForm />;
}
