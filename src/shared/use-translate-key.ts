import { useTranslations } from "next-intl";

/**
 * Translates a full message key that comes from data, e.g. a Zod issue message such as
 * "accounts.validation.nameRequired". A key without a message is shown as it is.
 */
export function useTranslateKey() {
  const t = useTranslations();
  return (key: string) => {
    const typed = key as Parameters<typeof t>[0];
    return t.has(typed) ? t(typed) : key;
  };
}
