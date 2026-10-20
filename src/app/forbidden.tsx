import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">Kein Zugriff</h1>
      <p>Du hast keinen Zugriff auf diese Seite.</p>
      <Link href="/" className="btn btn-primary">
        Zur Startseite
      </Link>
    </main>
  );
}
