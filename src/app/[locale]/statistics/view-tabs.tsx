import Link from "next/link";
import { useTranslations } from "next-intl";

/** Tabs between the month view and the year view, keeping the selected account. */
export function ViewTabs({ view, accountId }: { view: "months" | "year"; accountId: string }) {
  const t = useTranslations("app.statistics");
  const tabs = [
    { key: "months", href: `/statistics?account=${accountId}`, label: t("tabMonth") },
    { key: "year", href: `/statistics/year?account=${accountId}`, label: t("tabYear") },
  ] as const;
  return (
    <nav aria-label={t("views")}>
      <div role="tablist" className="flex gap-6 border-b border-base-300">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            role="tab"
            aria-current={tab.key === view ? "page" : undefined}
            className={`-mb-px border-b-2 pb-2 text-sm ${
              tab.key === view ? "border-primary font-medium text-base-content" : "border-transparent text-base-content/60 hover:text-base-content"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
