import { useTranslations } from "next-intl";
import { categoryMessageKey, isOwnCategoryKey } from "../categories";

/**
 * Translates a category key ("groceries.supermarket") into its name. Own categories take their name
 * from `names` (the page's catalog); one the caller cannot resolve shows "Eigene Kategorie".
 */
export function useCategoryName(names?: Record<string, string>) {
  const t = useTranslations("transactions");
  return (key: string) => {
    if (isOwnCategoryKey(key)) return names?.[key] ?? t("ownUnknown");
    return t(categoryMessageKey(key) as Parameters<typeof t>[0]);
  };
}
