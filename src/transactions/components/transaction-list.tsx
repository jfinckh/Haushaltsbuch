import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { formatEuro } from "@/shared/money";
import type { TransactionView } from "../create-transactions";
import { useCategoryName } from "./use-category-name";

type Props = {
  transactions: TransactionView[];
  /** Link to one booking: `${href}/${id}`. Default: /transactions */
  href?: string;
};

function byDate(transactions: TransactionView[]): [string, TransactionView[]][] {
  const groups = new Map<string, TransactionView[]>();
  for (const t of transactions) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
  return [...groups];
}

function Row({ transaction, href }: { transaction: TransactionView; href: string }) {
  const t = useTranslations("transactions");
  const categoryName = useCategoryName();
  const categorized = transaction.kind === "transfer" || transaction.kind === "saving" || transaction.category !== null;
  return (
    <li>
      <Link href={`${href}/${transaction.id}`} className="flex items-center justify-between gap-3 rounded-box p-2 hover:bg-base-200">
        <div className="min-w-0">
          <p className="truncate font-medium">{transaction.counterparty ?? transaction.reference ?? t("list.noText")}</p>
          <p className="flex flex-wrap items-center gap-1 text-sm opacity-70">
            {transaction.category ? categoryName(transaction.category) : t(`kinds.${transaction.kind}`)}
            {!categorized && <span className="badge badge-warning badge-sm">{t("list.uncategorized")}</span>}
          </p>
        </div>
        <span className={`shrink-0 tabular-nums ${transaction.amountCents < 0 ? "" : "text-success"}`}>
          {formatEuro(transaction.amountCents)}
        </span>
      </Link>
    </li>
  );
}

/** Bookings grouped by date, newest first; uncategorized expenses and income are marked. */
export function TransactionList({ transactions, href = "/transactions" }: Props) {
  const t = useTranslations("transactions.list");
  const format = useFormatter();
  if (transactions.length === 0) return <p className="opacity-70">{t("empty")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {byDate(transactions).map(([date, items]) => (
        <section key={date}>
          <h3 className="px-2 text-sm font-semibold opacity-70">
            {format.dateTime(new Date(`${date}T00:00:00Z`), { timeZone: "UTC", weekday: "short", day: "numeric", month: "long" })}
          </h3>
          <ul className="flex flex-col">
            {items.map((transaction) => (
              <Row key={transaction.id} transaction={transaction} href={href} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
