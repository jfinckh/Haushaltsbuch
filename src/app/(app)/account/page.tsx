import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountSettings } from "@/auth";
import { authServer } from "@/config/auth";

export const metadata: Metadata = { title: "Kontoeinstellungen · Haushaltsbuch" };

export default function Page() {
  return (
    <Suspense fallback={<span className="loading loading-spinner" />}>
      <Guarded />
    </Suspense>
  );
}

async function Guarded() {
  await authServer.requireSession({ redirectTo: "/account" });
  return <AccountSettings />;
}
