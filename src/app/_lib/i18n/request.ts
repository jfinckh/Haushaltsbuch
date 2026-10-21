import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { locale as rootLocale } from "next/root-params";
import { messages } from "./messages";
import { routing } from "./routing";

// The language comes from the [locale] folder (a root param), so pages stay static.
export default getRequestConfig(async () => {
  const requested = await rootLocale();
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { locale, messages: messages[locale], timeZone: "Europe/Berlin" };
});
