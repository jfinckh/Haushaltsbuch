export type BookingsFilter = {
  /** An account id or "all" (all own private accounts). */
  account: string;
  /** YYYY-MM */
  month?: string;
  year?: number;
  kind?: "expense" | "income" | "saving";
  /** A category key; null means bookings without category. */
  category?: string | null;
  /** The address of the page the link is on, so the bookings page can link back to it. */
  origin?: string;
};

/** The address of the bookings page filtered like a statistics figure. Absent fields are left out. */
export function bookingsHref({ account, month, year, kind, category, origin }: BookingsFilter): string {
  const params = new URLSearchParams({ account });
  if (month !== undefined) params.set("month", month);
  if (year !== undefined) params.set("year", String(year));
  if (kind !== undefined) params.set("kind", kind);
  if (category !== undefined) params.set("category", category === null ? "none" : category);
  if (origin !== undefined) params.set("origin", origin);
  return `/transactions?${params}`;
}
