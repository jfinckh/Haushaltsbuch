import { useTranslations } from "next-intl";
import { useCategoryName } from "@/transactions";
import type { RuleAccount, RuleScope, RuleView } from "../types";

/** Describes a rule's scope, condition and result in words. */
export function useRuleTexts(accounts: readonly RuleAccount[]) {
  const t = useTranslations("rules");
  const categoryName = useCategoryName();
  /** "Lebensmittel › Supermarkt" for a subcategory, the group's name for a group. */
  const fullCategoryName = (key: string) => {
    const [group, sub] = key.split(".");
    return sub ? `${categoryName(group)} › ${categoryName(key)}` : categoryName(key);
  };
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? t("scope.unknownAccount");

  return {
    scope(scope: RuleScope) {
      if (scope.type === "account") return t("scope.account", { account: accountName(scope.accountId) });
      return t(`scope.${scope.type}`);
    },
    condition(rule: Pick<RuleView, "counterparty" | "reference" | "amountSign">) {
      const parts = [
        rule.counterparty && t("condition.counterparty", { text: rule.counterparty }),
        rule.reference && t("condition.reference", { text: rule.reference }),
        rule.amountSign && t(`condition.${rule.amountSign}`),
      ].filter(Boolean);
      return parts.join(t("condition.and"));
    },
    result(rule: Pick<RuleView, "kind" | "category" | "transferTarget">) {
      return [t(`kinds.${rule.kind}`), rule.category && fullCategoryName(rule.category), rule.transferTarget && t("result.external")]
        .filter(Boolean)
        .join(" · ");
    },
  };
}
