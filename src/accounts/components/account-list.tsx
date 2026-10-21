import Link from "next/link";
import { formatEuro } from "@/shared/money";
import type { AccountView } from "../create-accounts";
import { BANK_LABELS, ROLE_LABELS, TYPE_LABELS } from "../validation";

type Props = {
  accounts: AccountView[];
  /** Link to one account: `${href}/${id}`. Default: /accounts */
  href?: string;
};

function AccountRow({ account, href }: { account: AccountView; href: string }) {
  return (
    <li>
      <Link href={`${href}/${account.id}`} className="flex items-center justify-between gap-3 rounded-box p-2 hover:bg-base-200">
        <div className="min-w-0">
          <p className="truncate font-medium">{account.name}</p>
          <p className="flex flex-wrap items-center gap-1 text-sm opacity-70">
            {BANK_LABELS[account.bank]} · {TYPE_LABELS[account.type]}
            <span className="badge badge-ghost badge-sm">{ROLE_LABELS[account.role]}</span>
            <span className={`badge badge-sm ${account.visibility === "private" ? "badge-neutral" : "badge-info"}`}>
              {account.visibility === "private" ? "Private" : "Shared"}
            </span>
          </p>
        </div>
        <span className={`shrink-0 tabular-nums ${account.openingBalanceCents < 0 ? "text-error" : ""}`}>
          {formatEuro(account.openingBalanceCents)}
        </span>
      </Link>
    </li>
  );
}

/** The accounts the user may see with their opening balances; archived ones folded away. */
export function AccountList({ accounts, href = "/accounts" }: Props) {
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  return (
    <div className="flex flex-col gap-2">
      {active.length === 0 ? (
        <p className="opacity-70">No accounts yet.</p>
      ) : (
        <ul className="flex flex-col">
          {active.map((account) => (
            <AccountRow key={account.id} account={account} href={href} />
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <details className="collapse collapse-arrow bg-base-200">
          <summary className="collapse-title text-sm">Archived ({archived.length})</summary>
          <ul className="collapse-content flex flex-col">
            {archived.map((account) => (
              <AccountRow key={account.id} account={account} href={href} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
