import { useTranslations } from "next-intl";
import Link from "next/link";
import { formatEuro } from "@/shared/money";
import type { AccountView } from "../create-accounts";

type Props = {
  accounts: AccountView[];
  /** Link to one account: `${href}/${id}`. Default: /accounts */
  href?: string;
  /** Current balance per account id (cents). Without it, rows show the opening balance. */
  balances?: Record<string, number>;
};

function AccountRow({ account, href, balance }: { account: AccountView; href: string; balance: number }) {
  const t = useTranslations("accounts");
  return (
    <li>
      <Link href={`${href}/${account.id}`} className="flex items-center justify-between gap-3 rounded-box p-2 hover:bg-base-200">
        <div className="min-w-0">
          <p className="truncate font-medium">{account.name}</p>
          <p className="flex flex-wrap items-center gap-1 text-sm opacity-70">
            {t(`banks.${account.bank}`)} · {t(`types.${account.type}`)}
            <span className="badge badge-ghost badge-sm">{t(`roles.${account.role}`)}</span>
            <span className={`badge badge-sm ${account.visibility === "private" ? "badge-neutral" : "badge-info"}`}>
              {t(`visibility.${account.visibility}`)}
            </span>
          </p>
        </div>
        <span className={`shrink-0 tabular-nums ${balance < 0 ? "text-error" : ""}`}>
          {formatEuro(balance)}
        </span>
      </Link>
    </li>
  );
}

/** The accounts the user may see with their balances; archived ones folded away. */
export function AccountList({ accounts, href = "/accounts", balances }: Props) {
  const balanceOf = (account: AccountView) => balances?.[account.id] ?? account.openingBalanceCents;
  const t = useTranslations("accounts.list");
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  return (
    <div className="flex flex-col gap-2">
      {active.length === 0 ? (
        <p className="opacity-70">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col">
          {active.map((account) => (
            <AccountRow key={account.id} account={account} href={href} balance={balanceOf(account)} />
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <details className="collapse collapse-arrow bg-base-200">
          <summary className="collapse-title text-sm">{t("archived", { count: archived.length })}</summary>
          <ul className="collapse-content flex flex-col">
            {archived.map((account) => (
              <AccountRow key={account.id} account={account} href={href} balance={balanceOf(account)} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
