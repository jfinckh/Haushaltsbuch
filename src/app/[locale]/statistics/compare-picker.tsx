"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_COMPARE, statisticsHref } from "./compare-months";

/**
 * The compared months as chips (each with × to remove it) and, while fewer than MAX_COMPARE are
 * chosen, "+ compare month": a month and a year list and a button that adds the month.
 */
export function ComparePicker({
  account,
  month,
  compare,
  current,
  suggestion,
  chips,
  monthNames,
  years,
  labels,
}: {
  /** An account id or "all". */
  account: string;
  /** The main month (YYYY-MM). */
  month: string;
  /** The compared months (YYYY-MM). */
  compare: string[];
  /** The current month (YYYY-MM), the latest one to choose. */
  current: string;
  /** The month the lists start on (YYYY-MM). */
  suggestion: string;
  /** Each compared month with its name. */
  chips: { month: string; name: string; removeLabel: string }[];
  /** Month names, January first. */
  monthNames: string[];
  /** Years to choose, newest first. */
  years: number[];
  labels: { group: string; add: string; confirm: string; cancel: string; month: string; year: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(suggestion.slice(0, 4));
  const [number, setNumber] = useState(suggestion.slice(5, 7));
  const [currentYear, currentNumber] = current.split("-").map(Number);

  const add = () => {
    const chosen = `${year}-${number}`;
    setOpen(false);
    router.push(statisticsHref({ account, month, compare: [...compare, chosen > current ? current : chosen] }));
  };

  return (
    <div role="group" aria-label={labels.group} className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <span key={chip.month} className="badge badge-lg gap-1 border-base-300 bg-base-200 pr-1">
          {chip.name}
          <Link
            href={statisticsHref({ account, month, compare: compare.filter((m) => m !== chip.month) })}
            className="btn btn-ghost btn-xs btn-circle"
            aria-label={chip.removeLabel}
          >
            ×
          </Link>
        </span>
      ))}
      {compare.length < MAX_COMPARE &&
        (open ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <select aria-label={labels.month} className="select select-sm w-auto" value={number} onChange={(e) => setNumber(e.target.value)}>
              {monthNames.map((name, i) => {
                const value = String(i + 1).padStart(2, "0");
                return (
                  <option key={value} value={value} disabled={Number(year) === currentYear && i + 1 > currentNumber}>
                    {name}
                  </option>
                );
              })}
            </select>
            <select aria-label={labels.year} className="select select-sm w-auto tabular-nums" value={year} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm" onClick={add}>
              {labels.confirm}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              {labels.cancel}
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
            + {labels.add}
          </button>
        ))}
    </div>
  );
}
