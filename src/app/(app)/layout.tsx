import Link from "next/link";
import { UserMenu } from "@/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="navbar bg-base-100 shadow-sm px-4">
        <Link href="/" className="text-lg font-semibold grow">
          Haushaltsbuch
        </Link>
        <UserMenu />
      </header>
      <main className="flex flex-1 flex-col items-center p-4">{children}</main>
    </>
  );
}
