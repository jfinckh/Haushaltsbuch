import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { formatEuro } from "@/shared/money";
import type { TransactionView } from "../create-transactions";
import { useCategoryName } from "./use-category-name";

type Props = {
  transactions: TransactionView[];
  /** Link to one booking: `${href}/${id}`. Default: /transactions */
  href?: string;
  /** Names of the bookings' accounts; with it, each row shows its account (several accounts in one list). */
  accountNames?: Record<string, string>;
  /** Names of own categories (the page's catalog). */
  categoryNames?: Record<string, string>;
};

function byDate(transactions: TransactionView[]): [string, TransactionView[]][] {
  const groups = new Map<string, TransactionView[]>();
  for (const t of transactions) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
  return [...groups];
}

function amountClass(transaction: TransactionView): string {
  if (transaction.kind === "transfer" || transaction.kind === "saving") return "text-base-content/60";
  return transaction.amountCents < 0 ? "" : "text-success";
}

/**
 * One booking. In a narrow container: name, a line below, amount. From a wide container (@xl) on:
 * columns for name, category, account (when given) and amount.
 */
function Row({ transaction, href, accountName, categoryNames }: { transaction: TransactionView; href: string; accountName?: string; categoryNames?: Record<string, string> }) {
  const t = useTranslations("transactions");
  const categoryName = useCategoryName(categoryNames);
  const categorized = transaction.kind === "transfer" || transaction.kind === "saving" || transaction.category !== null;
  const label = transaction.category ? categoryName(transaction.category) : t(`kinds.${transaction.kind}`);
  const badge = !categorized && <span className="badge badge-soft badge-warning badge-sm">{t("list.uncategorized")}</span>;
  const columns = accountName === undefined ? "@xl:grid-cols-[minmax(0,1fr)_12rem_7.5rem]" : "@xl:grid-cols-[minmax(0,1fr)_12rem_10rem_7.5rem]";
  return (
    <li>
      <Link
        href={`${href}/${transaction.id}`}
        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-b border-base-300/70 px-1 py-2.5 transition-colors last:border-b-0 hover:bg-base-200/60 ${columns}`}
      >
        <div className="min-w-0">
          <p className="truncate font-medium">{transaction.counterparty ?? transaction.reference ?? t("list.noText")}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-base-content/60 @xl:hidden">
            {label}
            {accountName && <span>· {accountName}</span>}
            {badge}
          </p>
        </div>
        <p className="hidden min-w-0 items-center gap-1.5 text-sm text-base-content/70 @xl:flex">
          <span className="truncate">{label}</span>
          {badge}
        </p>
        {accountName !== undefined && <p className="hidden truncate text-sm text-base-content/60 @xl:block">{accountName}</p>}
        <span className={`text-right font-medium whitespace-nowrap ${amountClass(transaction)}`}>{formatEuro(transaction.amountCents)}</span>
      </Link>
    </li>
  );
}

/** Bookings grouped by date, newest first; uncategorized expenses and income are marked. */
export function TransactionList({ transactions, href = "/transactions", accountNames, categoryNames }: Props) {
  const t = useTranslations("transactions.list");
  const format = useFormatter();
  if (transactions.length === 0) return <p className="text-sm text-base-content/60">{t("empty")}</p>;
  return (
    <div className="@container flex min-w-0 flex-col gap-4">
      {byDate(transactions).map(([date, items]) => (
        <section key={date}>
          <h3 className="border-b border-base-300 px-1 pb-1 text-xs font-medium tracking-wide text-base-content/55 uppercase">
            {format.dateTime(new Date(`${date}T00:00:00Z`), { timeZone: "UTC", weekday: "short", day: "numeric", month: "long" })}
          </h3>
          <ul className="flex flex-col">
            {items.map((transaction) => (
              <Row
                key={transaction.id}
                transaction={transaction}
                href={href}
                accountName={accountNames ? (accountNames[transaction.accountId] ?? "") : undefined}
                categoryNames={categoryNames}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
