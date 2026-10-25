"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, type ReactNode } from "react";
import { SignOutButton } from "@/auth";
import { LocaleSwitcher } from "@/shared/locale-switcher";

type NavKey = "overview" | "statistics" | "imports" | "rules" | "categories" | "household";

type NavItem = {
  key: NavKey;
  href: string;
  /** Path prefixes that belong to this item (besides href). */
  also?: string[];
  /** Shown in the bottom bar on phones (five at most). */
  mobile: boolean;
  icon: ReactNode;
};

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const NAV: NavItem[] = [
  {
    key: "overview",
    href: "/",
    also: ["/transactions"],
    mobile: true,
    icon: <path {...stroke} d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  },
  {
    key: "statistics",
    href: "/statistics",
    mobile: true,
    icon: <path {...stroke} d="M5 19V11M10 19V6M15 19v-5M20 19V9M3.5 19.5h17" />,
  },
  {
    key: "imports",
    href: "/imports",
    mobile: true,
    icon: <path {...stroke} d="M12 4v10m0 0-4-4m4 4 4-4M5 16v2.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V16" />,
  },
  {
    key: "rules",
    href: "/rules",
    mobile: true,
    icon: <path {...stroke} d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  },
  {
    key: "categories",
    href: "/categories",
    mobile: false,
    icon: <path {...stroke} d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z" />,
  },
  {
    key: "household",
    href: "/household",
    also: ["/accounts"],
    mobile: true,
    icon: (
      <path
        {...stroke}
        d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.5 19c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5M16 11a2.5 2.5 0 1 0 0-5M17 14.5c1.9.3 3.1 1.8 3.5 4.5"
      />
    ),
  },
];

function isActive(pathname: string, item: NavItem) {
  const prefixes = [item.href, ...(item.also ?? [])];
  return prefixes.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
      {children}
    </svg>
  );
}

type Variant = "side" | "bar";

// The path is only known at request time, so the highlighted link streams in (Suspense) and the rest of the frame prerenders.
function CurrentNavLinks({ variant }: { variant: Variant }) {
  return <NavLinks variant={variant} pathname={usePathname()} />;
}

/** The links of the sidebar (all) or of the bottom bar on phones (the five marked mobile). */
function NavLinks({ variant, pathname }: { variant: Variant; pathname: string }) {
  const t = useTranslations("app.nav");
  if (variant === "bar") {
    return NAV.filter((item) => item.mobile).map((item) => {
      const active = isActive(pathname, item);
      return (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={`flex min-w-0 flex-col items-center gap-0.5 py-2 text-[0.7rem] ${active ? "text-primary" : "text-base-content/60"}`}
        >
          <Icon>{item.icon}</Icon>
          <span className="max-w-full truncate px-1">{t(item.key)}</span>
        </Link>
      );
    });
  }
  return NAV.map((item) => {
    const active = isActive(pathname, item);
    return (
      <Link
        key={item.key}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-box px-3 py-2 text-sm transition-colors ${
          active ? "bg-base-100 font-medium text-base-content ring-1 ring-base-300" : "text-base-content/70 hover:bg-base-300/50 hover:text-base-content"
        }`}
      >
        <Icon>{item.icon}</Icon>
        {item.key === "household" ? t("householdLong") : t(item.key)}
      </Link>
    );
  });
}

/**
 * Frame of every signed-in page: sidebar on wide screens, top line and bottom bar on phones.
 * `narrow` keeps forms at a readable width.
 */
export function AppShell({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  const t = useTranslations("app.nav");

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-base-300 bg-base-200 px-3 py-5 lg:flex">
        <Link href="/" className="px-3 text-[0.95rem] font-semibold tracking-tight">
          {t("appName")}
        </Link>
        <nav aria-label={t("label")} className="mt-8 flex flex-col gap-0.5">
          <Suspense fallback={<NavLinks variant="side" pathname="" />}>
            <CurrentNavLinks variant="side" />
          </Suspense>
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-base-300 px-1 pt-4">
          <LocaleSwitcher />
          <SignOutButton redirectTo="/sign-in?signedOut=1" className="btn btn-ghost btn-sm font-normal" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-2 border-b border-base-300 bg-base-100/95 px-4 backdrop-blur lg:hidden">
          <Link href="/" className="font-semibold tracking-tight">
            {t("appName")}
          </Link>
          <div className="flex items-center gap-1">
            <LocaleSwitcher />
            <SignOutButton redirectTo="/sign-in?signedOut=1" className="btn btn-ghost btn-xs font-normal" />
          </div>
        </header>
        <main className="flex-1 px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
          <div className={`mx-auto w-full ${narrow ? "max-w-xl" : "max-w-5xl"}`}>{children}</div>
        </main>
      </div>

      <nav
        aria-label={t("label")}
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-base-300 bg-base-100 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <Suspense fallback={<NavLinks variant="bar" pathname="" />}>
          <CurrentNavLinks variant="bar" />
        </Suspense>
      </nav>
    </div>
  );
}

/** Title line of a page: optional back link above, optional actions on the right. */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content">
            <span aria-hidden="true">←</span>
            {back.label}
          </Link>
        )}
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 max-w-prose text-sm text-base-content/60">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled part of a page, separated by a hairline. */
export function Section({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 border-t border-base-300 pt-5 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Frame of the pages before the app: sign-in, invite, first household. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const t = useTranslations("app.nav");
  return (
    <div className="flex min-h-dvh flex-col bg-base-200">
      <header className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <span className="font-semibold tracking-tight">{t("appName")}</span>
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:pt-20">{children}</main>
    </div>
  );
}
