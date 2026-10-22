import { useTranslations } from "next-intl";
import Link from "next/link";
import { formatEuro } from "@/shared/money";
import type { GroupSpending } from "../categories";
import { useCategoryName } from "./use-category-name";

type Props = {
  accountId: string;
  /** The calendar month of the figures, YYYY-MM. */
  month: string;
  /** Sum of the rows (cents). */
  totalCents: number;
  /** Spending per category group, largest first; `group: null` is expenses without category. */
  groups: GroupSpending[];
};

/** A month's expenses of one account per category group: a bar per group, each linking to its bookings. */
export function CategorySpending({ accountId, month, totalCents, groups }: Props) {
  const t = useTranslations("transactions.spending");
  const categoryName = useCategoryName();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      {groups.length === 0 ? (
        <p className="text-base-content/70 text-sm">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {groups.map(({ group, cents }) => {
            const params = new URLSearchParams({ month, kind: "expense" });
            if (group) params.set("category", group);
            const name = group ? categoryName(group) : t("uncategorized");
            const percent = Math.round((cents * 100) / totalCents);
            return (
              <li key={group ?? ""}>
                <Link href={`/accounts/${accountId}?${params}`} className="flex flex-col gap-1 rounded-box p-2 hover:bg-base-200">
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{name}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatEuro(cents)} <span className="opacity-70">· {t("share", { percent })}</span>
                    </span>
                  </span>
                  <progress className="progress progress-primary w-full" value={cents} max={totalCents} aria-label={name} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
