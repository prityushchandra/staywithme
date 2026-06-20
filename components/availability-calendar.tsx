"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SerializedBlock {
  startDate: string; // ISO
  endDate: string; // ISO (exclusive)
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function utcMidnight(y: number, m: number, d: number) {
  return Date.UTC(y, m, d);
}

// Read-only month calendar marking blocked nights as unavailable.
export function AvailabilityCalendar({ blocks }: { blocks: SerializedBlock[] }) {
  const today = new Date();
  const [view, setView] = useState({
    year: today.getUTCFullYear(),
    month: today.getUTCMonth(),
  });

  const blockedSet = useMemo(() => {
    const set = new Set<number>();
    for (const b of blocks) {
      const start = new Date(b.startDate);
      const end = new Date(b.endDate);
      for (
        let t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
        t < Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
        t += 86400000
      ) {
        set.add(t);
      }
    }
    return set;
  }, [blocks]);

  const todayUtc = utcMidnight(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const firstWeekday = new Date(Date.UTC(view.year, view.month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
  const monthLabel = new Date(Date.UTC(view.year, view.month, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  function shift(delta: number) {
    setView((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} className="rounded-full p-1.5 hover:bg-muted" aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">{monthLabel}</span>
        <button type="button" onClick={() => shift(1)} className="rounded-full p-1.5 hover:bg-muted" aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const t = utcMidnight(view.year, view.month, day);
          const isBlocked = blockedSet.has(t);
          const isPast = t < todayUtc;
          return (
            <div
              key={day}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md",
                isBlocked && "bg-muted text-muted-foreground line-through",
                isPast && !isBlocked && "text-muted-foreground/40",
                !isBlocked && !isPast && "text-foreground"
              )}
            >
              {day}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border bg-background" /> Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-muted" /> Unavailable
        </span>
      </div>
    </div>
  );
}
