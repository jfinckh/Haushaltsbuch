import type { Metadata } from "next";
import { TwoFactorForm } from "@/auth";

export const metadata: Metadata = { title: "Zwei-Faktor-Anmeldung · Haushaltsbuch" };

export default function Page() {
  return <TwoFactorForm />;
}
