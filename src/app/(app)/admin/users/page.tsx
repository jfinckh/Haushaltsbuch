import type { Metadata } from "next";
import { Suspense } from "react";
import { UserAdmin } from "@/auth";
import { authServer } from "@/config/auth";

export const metadata: Metadata = { title: "Benutzerverwaltung · Haushaltsbuch" };

export default function Page() {
  return (
    <Suspense fallback={<span className="loading loading-spinner" />}>
      <Guarded />
    </Suspense>
  );
}

async function Guarded() {
  await authServer.requireAdmin({ redirectTo: "/admin/users" });
  return (
    <div className="w-full max-w-5xl">
      <UserAdmin />
    </div>
  );
}
