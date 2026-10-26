import { useTranslations } from "next-intl";
import Link from "next/link";
import { formatEuro } from "@/shared/money";
import type { GroupSpending } from "../categories";
import { useCategoryName } from "./use-category-name";

type Props = {
  /** An account id or "all"; the rows link to its bookings. Without it they are not links. */
  account?: string;
  /** The calendar month of the figures, YYYY-MM. */
  month: string;
  /** Sum of the rows (cents). */
  totalCents: number;
  /** Spending per category group, largest first; `group: null` is expenses without category. */
  groups: GroupSpending[];
  /** Names of own categories (the page's catalog). */
  categoryNames?: Record<string, string>;
};

/** A month's expenses per category group: a bar per group, each linking to the matching bookings if an account is given. */
export function CategorySpending({ account, month, totalCents, groups, categoryNames }: Props) {
  const t = useTranslations("transactions.spending");
  const categoryName = useCategoryName(categoryNames);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      {groups.length === 0 ? (
        <p className="text-sm text-base-content/60">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {groups.map(({ group, cents }) => {
            const params = new URLSearchParams({ account: account ?? "", month, kind: "expense", category: group ?? "none" });
            const name = group ? categoryName(group) : t("uncategorized");
            const percent = Math.round((cents * 100) / totalCents);
            const content = (
              <>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate group-hover:text-primary">{name}</span>
                  <span className="shrink-0 font-medium">
                    {formatEuro(cents)} <span className="ml-1 text-xs font-normal text-base-content/55">{t("share", { percent })}</span>
                  </span>
                </span>
                <progress className="progress progress-primary w-full" value={cents} max={totalCents} aria-label={name} />
              </>
            );
            return (
              <li key={group ?? ""}>
                {account ? (
                  <Link href={`/transactions?${params}`} className="group flex flex-col gap-1.5 rounded-box px-1 py-2 [&:hover_progress]:opacity-80">
                    {content}
                  </Link>
                ) : (
                  <div className="flex flex-col gap-1.5 px-1 py-2">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
