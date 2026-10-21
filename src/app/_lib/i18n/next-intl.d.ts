import type { Locale } from "@/shared/i18n";
import type { Messages } from "./messages";

// Makes translation keys type-checked in every part.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
