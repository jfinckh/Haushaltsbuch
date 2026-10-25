import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ALL_MINE, offersAllMine } from "@/insights";

type SwitcherAccount = { id: string; name: string; archived: boolean; visibility: "private" | "shared" };

/**
 * The account tabs of the dashboard and the statistics page, in two groups: private accounts (led by
 * "Alle privaten Konten" when offered) and shared accounts. A group without accounts is left out.
 * Each tab links to `path?account=<id>`, plus `params` (e.g. the year).
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
  const active = accounts.filter((a) => !a.archived);
  const groups = [
    {
      key: "private",
      label: t("groupPrivate"),
      tabs: [...(offersAllMine(accounts) ? [{ id: ALL_MINE, name: t("allMine") }] : []), ...active.filter((a) => a.visibility === "private")],
    },
    { key: "shared", label: t("groupShared"), tabs: active.filter((a) => a.visibility === "shared") },
  ].filter((group) => group.tabs.length > 0);

  return (
    <nav aria-label={t("switcher")} className="-mx-4 flex min-w-0 flex-col gap-2 sm:mx-0 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
      {groups.map((group) => (
        <div key={group.key} role="group" aria-labelledby={`switcher-${group.key}`} className="flex min-w-0 items-center gap-2">
          <span id={`switcher-${group.key}`} className="w-20 shrink-0 pl-4 text-xs font-medium text-base-content/60 sm:w-auto sm:pl-0">
            {group.label}
          </span>
          {/* One line; scrolls sideways on narrow screens instead of wrapping or overflowing the page. */}
          <ul className="flex min-w-0 gap-1.5 overflow-x-auto pr-4 pb-1 [scrollbar-width:none] sm:flex-wrap sm:pr-0">
            {group.tabs.map((a) => {
              const isActive = a.id === selectedId;
              return (
                <li key={a.id} className="shrink-0">
                  <Link
                    href={`${path}?${new URLSearchParams({ account: a.id, ...params })}`}
                    aria-current={isActive ? "page" : undefined}
                    className={`inline-flex h-8 items-center rounded-field border px-3 text-sm whitespace-nowrap transition-colors ${
                      isActive
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
        </div>
      ))}
    </nav>
  );
}
