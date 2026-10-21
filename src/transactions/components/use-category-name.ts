import { useTranslations } from "next-intl";
import { categoryMessageKey } from "../categories";

/** Translates a category key ("groceries.supermarket") into its name. */
export function useCategoryName() {
  const t = useTranslations("transactions");
  return (key: string) => t(categoryMessageKey(key) as Parameters<typeof t>[0]);
}
