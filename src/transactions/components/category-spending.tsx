import { useTranslations } from "next-intl";
import Link from "next/link";
import { formatEuro } from "@/shared/money";
import type { GroupSpending } from "../categories";
import { useCategoryName } from "./use-category-name";

type Props = {
  /** The rows link to this account's bookings; without it (several accounts) they are not links. */
  accountId?: string;
  /** The calendar month of the figures, YYYY-MM. */
  month: string;
  /** Sum of the rows (cents). */
  totalCents: number;
  /** Spending per category group, largest first; `group: null` is expenses without category. */
  groups: GroupSpending[];
};

/** A month's expenses per category group: a bar per group, each linking to the account's bookings if one is given. */
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
            const content = (
              <>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium">{name}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatEuro(cents)} <span className="opacity-70">· {t("share", { percent })}</span>
                  </span>
                </span>
                <progress className="progress progress-primary w-full" value={cents} max={totalCents} aria-label={name} />
              </>
            );
            return (
              <li key={group ?? ""}>
                {accountId ? (
                  <Link href={`/accounts/${accountId}?${params}`} className="flex flex-col gap-1 rounded-box p-2 hover:bg-base-200">
                    {content}
                  </Link>
                ) : (
                  <div className="flex flex-col gap-1 p-2">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
