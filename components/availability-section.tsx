"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBooking } from "@/components/booking-context";
import {
  dayHint,
  getDayAvailability,
  type DateRange,
  type DayAvailability,
} from "@/lib/dates";

// Airbnb-style availability calendar: two months, booked & past dates disabled
// (struck through), and the selected range highlighted. Clicking dates drives
// the shared booking state, so the sticky booking card stays in sync. Day
// availability comes from the one shared rule in `lib/dates.ts`, so this
// calendar, the popover picker and the server's validation can't drift.

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function parseYmd(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function fmt(s: string) {
  const d = parseYmd(s);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
}
function nights(ci: string, co: string) {
  const a = parseYmd(ci);
  const b = parseYmd(co);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function AvailabilitySection() {
  // Blocked nights come from the context, not a prop: the Reserve re-check
  // pushes freshly-booked ranges into it, and this on-page calendar has to
  // repaint them or it would keep offering nights the server just rejected.
  const { checkIn, checkOut, pickDate, setRange, blockedRanges } = useBooking();
  const [hovered, setHovered] = useState<Date | null>(null);
  // Which way the grids should slide when paging months.
  const [dir, setDir] = useState<1 | -1>(1);

  const today = useMemo(() => startOfToday(), []);
  const [view, setView] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));

  // Date-only blocked ranges (start inclusive, end exclusive).
  const blockDates = useMemo<DateRange[]>(
    () =>
      blockedRanges
        .map((b) => ({
          startDate: parseYmd(b.startDate.slice(0, 10)),
          endDate: parseYmd(b.endDate.slice(0, 10)),
        }))
        .filter((b): b is DateRange => b.startDate !== null && b.endDate !== null),
    [blockedRanges]
  );

  const start = parseYmd(checkIn);
  const end = parseYmd(checkOut);

  // One shared rule, same as the booking card. A free night that simply can't
  // be reached as a checkout (booked nights sit in between) comes back as
  // `restart`: dimmed but still CLICKABLE, so tapping it starts a new trip
  // there instead of silently swallowing the tap.
  const dayStatus = (day: Date): DayAvailability =>
    getDayAvailability(day, {
      checkIn: start,
      checkOut: end,
      blocks: blockDates,
      today,
    });

  function handlePick(day: Date) {
    const status = dayStatus(day);
    if (status.disabled) return;
    setHovered(null);
    // Tapping the pending check-in again clears the trip — there is always an
    // obvious way out of a half-finished selection.
    if (status.clearsSelection) {
      setRange("", "");
      return;
    }
    pickDate(toYmd(day));
  }

  function clear() {
    setHovered(null);
    setRange("", "");
  }

  const n = nights(checkIn, checkOut);
  const canGoBack =
    view.year > today.getFullYear() ||
    (view.year === today.getFullYear() && view.month > today.getMonth());

  function shift(delta: number) {
    setDir(delta > 0 ? 1 : -1);
    setView((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  const helper =
    n > 0
      ? `${fmt(checkIn)} – ${fmt(checkOut)} · ${n} night${n > 1 ? "s" : ""} selected`
      : checkIn
        ? `Now pick a checkout after ${fmt(checkIn)}`
        : "Select your check-in date. Booked dates are unavailable.";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl font-semibold">
            {n > 0 ? `${n} night${n > 1 ? "s" : ""}` : "Availability"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {helper}
          </p>
        </div>
        <button
          type="button"
          onClick={clear}
          disabled={!checkIn && !checkOut}
          className="shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold underline underline-offset-4 transition-[background-color,color,transform] duration-150 ease-ios active:scale-95 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100 [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-brand"
        >
          Clear dates
        </button>
      </div>

      <div className="relative mt-5">
        <button
          type="button"
          onClick={() => canGoBack && shift(-1)}
          disabled={!canGoBack}
          className="absolute left-0 top-0 z-10 rounded-full p-2 transition-[background-color,transform] duration-150 ease-ios active:scale-90 active:bg-muted disabled:opacity-30 motion-reduce:transition-none motion-reduce:active:scale-100 [@media(hover:hover)]:hover:bg-muted"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => shift(1)}
          className="absolute right-0 top-0 z-10 rounded-full p-2 transition-[background-color,transform] duration-150 ease-ios active:scale-90 active:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100 [@media(hover:hover)]:hover:bg-muted"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {/* Re-keyed on every page so the grids slide in from the side the guest
            paged towards instead of blinking into place. */}
        <div className="overflow-hidden">
          <div
            key={`${view.year}-${view.month}`}
            className={cn(
              "flex flex-col gap-8 duration-200 ease-ios animate-in fade-in motion-reduce:animate-none sm:flex-row sm:gap-12",
              dir > 0 ? "slide-in-from-right-4" : "slide-in-from-left-4"
            )}
          >
            <MonthGrid
              year={view.year}
              month={view.month}
              today={today}
              start={start}
              end={end}
              hovered={hovered}
              dayStatus={dayStatus}
              onPick={handlePick}
              onHover={setHovered}
            />
            <MonthGrid
              year={view.month === 11 ? view.year + 1 : view.year}
              month={(view.month + 1) % 12}
              today={today}
              start={start}
              end={end}
              hovered={hovered}
              dayStatus={dayStatus}
              onPick={handlePick}
              onHover={setHovered}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  year,
  month,
  today,
  start,
  end,
  hovered,
  dayStatus,
  onPick,
  onHover,
}: {
  year: number;
  month: number;
  today: Date;
  start: Date | null;
  end: Date | null;
  hovered: Date | null;
  dayStatus: (d: Date) => DayAvailability;
  onPick: (d: Date) => void;
  onHover: (d: Date | null) => void;
}) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = new Date(year, month, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Tentative end while the pointer sweeps the grid — only ever a day that is
  // genuinely reachable as a checkout, so the band can't paint over booked nights.
  const rangeEnd =
    end ?? (start && hovered && hovered.getTime() > start.getTime() ? hovered : null);

  const cells = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
    [year, month, daysInMonth]
  );

  return (
    <div className="flex-1 select-none">
      <div className="mb-3 text-center text-sm font-semibold">{monthLabel}</div>
      <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      {/* Six rows reserved so paging between a 5- and 6-row month can't jolt the
          layout, and the hover preview is cleared here (not per cell) so it
          doesn't flicker as the pointer crosses the gaps between days. */}
      <div
        className="grid min-h-[264px] grid-cols-7 content-start"
        onMouseLeave={() => onHover(null)}
      >
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {cells.map((day) => {
          const t = day.getTime();
          const status = dayStatus(day);
          const isStart = !!start && t === start.getTime();
          const isEnd = !!rangeEnd && t === rangeEnd.getTime();
          const inRange =
            !!start && !!rangeEnd && t > start.getTime() && t < rangeEnd.getTime();
          const isEndpoint = isStart || isEnd;
          const banded = inRange || (isEndpoint && !!rangeEnd);
          const hint = dayHint(status, isEndpoint);

          return (
            <div
              key={t}
              className={cn(
                "flex h-11 items-center justify-center transition-[background-color,border-radius] duration-150 ease-ios motion-reduce:transition-none",
                banded && "bg-brand/10",
                isStart && rangeEnd && "rounded-l-full",
                isEnd && "rounded-r-full"
              )}
            >
              <button
                type="button"
                disabled={status.disabled}
                onClick={() => onPick(day)}
                onMouseEnter={() =>
                  onHover(status.disabled || status.restartsRange ? null : day)
                }
                title={hint}
                aria-label={`${day.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}${hint ? ` — ${hint}` : ""}`}
                className={cn(
                  "flex h-10 w-10 touch-manipulation items-center justify-center rounded-full text-sm transition-[background-color,color,transform,box-shadow] duration-150 ease-ios focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 motion-reduce:transition-none",
                  !status.disabled && "active:scale-90 motion-reduce:active:scale-100",
                  !isEndpoint &&
                    !status.disabled &&
                    "[@media(hover:hover)]:hover:bg-brand/10 [@media(hover:hover)]:hover:ring-1 [@media(hover:hover)]:hover:ring-foreground/60",
                  isEndpoint && "bg-brand font-semibold text-white shadow-sm",
                  status.kind === "blocked" &&
                    !isEndpoint &&
                    "cursor-not-allowed text-muted-foreground/40 line-through",
                  status.kind === "past" &&
                    !isEndpoint &&
                    "cursor-default text-muted-foreground/30",
                  status.checkoutOnly &&
                    !isEndpoint &&
                    "text-foreground underline decoration-dotted underline-offset-4",
                  // Free, but unreachable from this check-in: dimmed yet clickable —
                  // tapping it starts a new trip rather than doing nothing.
                  status.restartsRange && !isEndpoint && "text-muted-foreground/60",
                  t === today.getTime() && !isEndpoint && "font-semibold"
                )}
              >
                {day.getDate()}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
