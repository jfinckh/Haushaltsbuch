import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ALL_MINE, offersAllMine } from "./select-account";

type SwitcherAccount = { id: string; name: string; archived: boolean; visibility: "private" | "shared" };

/**
 * The account tabs of the dashboard and the statistics page: "Alle meine Konten" (when offered) and
 * every active visible account. Each tab links to `path?account=<id>`.
 */
export async function AccountSwitcher({ accounts, selectedId, path }: { accounts: SwitcherAccount[]; selectedId: string; path: string }) {
  const t = await getTranslations("app.home");
  const tabs = [...(offersAllMine(accounts) ? [{ id: ALL_MINE, name: t("allMine") }] : []), ...accounts.filter((a) => !a.archived)];
  return (
    <nav aria-label={t("switcher")}>
      <div role="tablist" className="tabs tabs-box flex-wrap">
        {tabs.map((a) => (
          <Link
            key={a.id}
            href={`${path}?account=${a.id}`}
            role="tab"
            aria-current={a.id === selectedId ? "page" : undefined}
            className={`tab whitespace-nowrap ${a.id === selectedId ? "tab-active" : ""}`}
          >
            {a.name}
          </Link>
        ))}
      </div>
    </nav>
  );
}
