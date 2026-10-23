import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { LOCALES } from "@/shared/i18n";
import "../globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// One static version of every page per language.
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app.metadata");
  return { title: "Haushaltsbuch", description: t("description") };
}

// Each page brings its own frame (AppShell or AuthFrame from app/_lib/app-shell).
export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(LOCALES, locale)) notFound();

  return (
    <html lang={locale} className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-base-100 text-base-content">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
