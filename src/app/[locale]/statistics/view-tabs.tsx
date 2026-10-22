import Link from "next/link";
import { useTranslations } from "next-intl";

/** Tabs between the last 12 months and the year view, keeping the selected account. */
export function ViewTabs({ view, accountId }: { view: "months" | "year"; accountId: string }) {
  const t = useTranslations("app.statistics");
  const tabs = [
    { key: "months", href: `/statistics?account=${accountId}`, label: t("tabMonths") },
    { key: "year", href: `/statistics/year?account=${accountId}`, label: t("tabYear") },
  ] as const;
  return (
    <nav aria-label={t("views")}>
      <div role="tablist" className="tabs tabs-border">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            role="tab"
            aria-current={tab.key === view ? "page" : undefined}
            className={`tab ${tab.key === view ? "tab-active" : ""}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
