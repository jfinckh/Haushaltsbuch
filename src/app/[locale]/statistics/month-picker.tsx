"use client";

import { useRouter } from "next/navigation";

/**
 * Two lists, month and year, that load the chosen month of the statistics page at once.
 * Months after `current` are disabled; a year change that would land in the future shows `current`.
 */
export function MonthPicker({
  month,
  current,
  accountId,
  monthNames,
  years,
  labels,
}: {
  /** The shown month (YYYY-MM). */
  month: string;
  /** The current month (YYYY-MM), the latest one to choose. */
  current: string;
  accountId: string;
  /** Month names, January first. */
  monthNames: string[];
  /** Years to choose, newest first. */
  years: number[];
  labels: { month: string; year: string };
}) {
  const router = useRouter();
  const [year, number] = month.split("-");
  const [currentYear, currentNumber] = current.split("-").map(Number);

  const go = (y: string, m: string) => {
    const chosen = `${y}-${m}`;
    router.push(`/statistics?${new URLSearchParams({ account: accountId, month: chosen > current ? current : chosen })}`);
  };

  return (
    <div className="flex items-center gap-1.5">
      <select
        aria-label={labels.month}
        className="select select-sm w-auto font-semibold"
        value={number}
        onChange={(event) => go(year, event.target.value)}
      >
        {monthNames.map((name, i) => {
          const value = String(i + 1).padStart(2, "0");
          return (
            <option key={value} value={value} disabled={Number(year) === currentYear && i + 1 > currentNumber}>
              {name}
            </option>
          );
        })}
      </select>
      <select
        aria-label={labels.year}
        className="select select-sm w-auto font-semibold tabular-nums"
        value={year}
        onChange={(event) => go(event.target.value, number)}
      >
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
