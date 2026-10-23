import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ALL_MINE, offersAllMine } from "@/insights";

type SwitcherAccount = { id: string; name: string; archived: boolean; visibility: "private" | "shared" };

/**
 * The account tabs of the dashboard and the statistics page: "Alle meine Konten" (when offered) and
 * every active visible account. Each tab links to `path?account=<id>`, plus `params` (e.g. the year).
 */
export async function AccountSwitcher({
  accounts,
  selectedId,
  path,
  params = {},
}: {
  accounts: SwitcherAccount[];
  selectedId: string;
  path: string;
  params?: Record<string, string>;
}) {
  const t = await getTranslations("app.home");
  const tabs = [...(offersAllMine(accounts) ? [{ id: ALL_MINE, name: t("allMine") }] : []), ...accounts.filter((a) => !a.archived)];
  return (
    <nav aria-label={t("switcher")} className="-mx-4 min-w-0 sm:mx-0">
      {/* One line; scrolls sideways on narrow screens instead of wrapping or overflowing the page. */}
      <ul className="flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:flex-wrap sm:px-0">
        {tabs.map((a) => {
          const active = a.id === selectedId;
          return (
            <li key={a.id} className="shrink-0">
              <Link
                href={`${path}?${new URLSearchParams({ account: a.id, ...params })}`}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-8 items-center rounded-field border px-3 text-sm whitespace-nowrap transition-colors ${
                  active
                    ? "border-base-content bg-base-content text-base-100"
                    : "border-base-300 text-base-content/75 hover:border-base-content/40 hover:text-base-content"
                }`}
              >
                {a.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
