"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { addBookingHref, showAddBooking } from "./add-booking-href";

/**
 * Round "+" button on phones, above the bottom bar: opens the booking form with the page's account.
 * Only on overview, bookings, account and statistics pages, never over a form.
 */
export function AddBookingButton() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const t = useTranslations("app.nav");
  if (!showAddBooking(pathname)) return null;
  return (
    <Link
      href={addBookingHref(pathname, search)}
      aria-label={t("addBooking")}
      title={t("addBooking")}
      className="btn btn-primary btn-circle btn-lg fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 shadow-lg lg:hidden"
    >
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      </svg>
    </Link>
  );
}
