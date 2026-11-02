// The counting month of a booking: the month its amount counts for (YYYY-MM). Usually the booking
// month. Salary paid at the end of a month pays for the next one, so income in the category Gehalt
// booked on SALARY_SHIFT_FROM_DAY or later counts for the next month. A person's choice
// (countsNextMonth true or false) always wins. Browser-safe; the same rule in SQL is in access.ts.

import type { TransactionKind } from "./kinds";
import { monthOf, shiftMonth } from "./months";

/** From this day of the month on, salary counts for the next month. */
export const SALARY_SHIFT_FROM_DAY = 20;

/** The standard salary group; own subcategories below it are `salary.c_<id>`. */
export const SALARY_GROUP = "salary";

export type CountingMonthInput = {
  bookingDate: string;
  kind: TransactionKind;
  category: string | null;
  /** A person's choice; null or absent means automatic. */
  countsNextMonth?: boolean | null;
};

/** Whether the automatic rule moves a booking to the next month (ignores a person's choice). */
export function shiftsAutomatically({ bookingDate, kind, category }: CountingMonthInput): boolean {
  const isSalary = category === SALARY_GROUP || (category?.startsWith(`${SALARY_GROUP}.`) ?? false);
  return kind === "income" && isSalary && Number(bookingDate.slice(8, 10)) >= SALARY_SHIFT_FROM_DAY;
}

/** The month a booking's amount counts for. */
export function countingMonthOf(booking: CountingMonthInput): string {
  const next = booking.countsNextMonth ?? shiftsAutomatically(booking);
  const month = monthOf(booking.bookingDate);
  return next ? shiftMonth(month, 1) : month;
}
