import { useTranslations } from "next-intl";
import type { z } from "zod";

/** First message key per field, for showing under form inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

/** Translates a full message key such as "auth.validation.emailInvalid"; unknown keys stay as they are. */
export function useTranslateKey() {
  const t = useTranslations();
  return (key: string) => {
    const typed = key as Parameters<typeof t>[0];
    return t.has(typed) ? t(typed) : key;
  };
}
