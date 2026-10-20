import { Suspense } from "react";
import { authServer } from "@/config/auth";

export default function Home() {
  return (
    <Suspense fallback={<span className="loading loading-spinner" />}>
      <Welcome />
    </Suspense>
  );
}

async function Welcome() {
  const { user } = await authServer.requireSession();
  return (
    <div className="card bg-base-100 shadow-sm w-full max-w-2xl">
      <div className="card-body">
        <h1 className="card-title text-2xl">Hallo {user.name}</h1>
        <p>Du bist angemeldet. Hier entsteht das Dashboard.</p>
      </div>
    </div>
  );
}
