import { accountsMessages } from "@/accounts";
import { authMessages } from "@/auth";
import { budgetsMessages } from "@/budgets";
import { householdsMessages } from "@/households";
import { importMessages } from "@/import";
import type { Locale } from "@/shared/i18n";
import { rulesMessages } from "@/rules";
import { messages as sharedMessages } from "@/shared/messages";
import { transactionsMessages } from "@/transactions";
import { transfersMessages } from "@/transfers";
import de from "../messages/de.json";
import en from "../messages/en.json";

const appMessages = { de, en };

function forLocale<L extends Locale>(locale: L) {
  return {
    app: appMessages[locale],
    shared: sharedMessages[locale],
    auth: authMessages[locale],
    households: householdsMessages[locale],
    accounts: accountsMessages[locale],
    transactions: transactionsMessages[locale],
    import: importMessages[locale],
    transfers: transfersMessages[locale],
    rules: rulesMessages[locale],
    budgets: budgetsMessages[locale],
  };
}

/** All texts per language, one namespace per part. English is the reference for the keys. */
export const messages = { de: forLocale("de"), en: forLocale("en") };

export type Messages = (typeof messages)["en"];
