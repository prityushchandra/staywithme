"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBooking } from "@/components/booking-context";
import { isBlockedNight, isSelectableCheckout, type DateRange } from "@/lib/dates";

// Airbnb-style availability calendar: two months, booked & past dates disabled
// (struck through), and the selected range highlighted. Clicking dates drives
// the shared booking state, so the sticky booking card stays in sync.

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayYmd() {
  return toYmd(new Date());
}
function parseYmd(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function fmt(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
function nights(ci: string, co: string) {
  if (!ci || !co) return 0;
  const a = new Date(ci).getTime();
  const b = new Date(co).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function AvailabilitySection({
  blockedRanges,
}: {
  blockedRanges: { startDate: string; endDate: string }[];
}) {
  const { checkIn, checkOut, pickDate } = useBooking();
  const today = todayYmd();
  const [hovered, setHovered] = useState<string | null>(null);

  const startView = new Date();
  const [view, setView] = useState({
    year: startView.getFullYear(),
    month: startView.getMonth(),
  });

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
  const isBlocked = (ymd: string) => {
    const day = parseYmd(ymd);
    return day ? isBlockedNight(day, blockDates) : false;
  };

  // Availability of a day given the current selection phase (mirrors the booking
  // card, via the same shared helpers). While choosing a checkout, the first
  // booked night after check-in is a valid "checkout-only" date — same-day
  // turnover, exactly like Airbnb.
  const dayStatus = (ymd: string): { disabled: boolean; checkoutOnly: boolean } => {
    const day = parseYmd(ymd);
    if (!day) return { disabled: true, checkoutOnly: false };
    const isPast = ymd < today;
    const blockedNight = isBlockedNight(day, blockDates);
    const ci = parseYmd(checkIn);
    const choosingCheckout = !!ci && !checkOut;

    if (choosingCheckout && ci) {
      if (day.getTime() <= ci.getTime()) {
        return { disabled: isPast || blockedNight, checkoutOnly: false };
      }
      if (!isSelectableCheckout(ci, day, blockDates)) {
        return { disabled: true, checkoutOnly: false };
      }
      return { disabled: isPast, checkoutOnly: blockedNight };
    }
    return { disabled: isPast || blockedNight, checkoutOnly: false };
  };

  const n = nights(checkIn, checkOut);
  const canGoBack =
    view.year > new Date().getFullYear() ||
    (view.year === new Date().getFullYear() && view.month > new Date().getMonth());

  function shift(delta: number) {
    setView((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  // Tentative end while hovering (only when a start is set and no end yet).
  const rangeEnd =
    checkOut || (checkIn && hovered && hovered > checkIn ? hovered : "");

  return (
    <div>
      <h3 className="text-xl font-semibold">
        {n > 0 ? `${n} night${n > 1 ? "s" : ""}` : "Availability"}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {checkIn && checkOut
          ? `${fmt(checkIn)} – ${fmt(checkOut)}`
          : "Select your check-in and check-out dates. Booked dates are unavailable."}
      </p>

      <div className="relative mt-5">
        <button
          type="button"
          onClick={() => canGoBack && shift(-1)}
          disabled={!canGoBack}
          className="absolute left-0 top-0 rounded-full p-2 hover:bg-muted disabled:opacity-30"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => shift(1)}
          className="absolute right-0 top-0 rounded-full p-2 hover:bg-muted"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div className="flex flex-col gap-8 sm:flex-row sm:gap-12">
          <MonthGrid
            year={view.year}
            month={view.month}
            today={today}
            checkIn={checkIn}
            rangeEnd={rangeEnd}
            isBlocked={isBlocked}
            dayStatus={dayStatus}
            onPick={pickDate}
            onHover={setHovered}
          />
          <MonthGrid
            year={view.month === 11 ? view.year + 1 : view.year}
            month={(view.month + 1) % 12}
            today={today}
            checkIn={checkIn}
            rangeEnd={rangeEnd}
            isBlocked={isBlocked}
            dayStatus={dayStatus}
            onPick={pickDate}
            onHover={setHovered}
          />
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  year,
  month,
  today,
  checkIn,
  rangeEnd,
  isBlocked,
  dayStatus,
  onPick,
  onHover,
}: {
  year: number;
  month: number;
  today: string;
  checkIn: string;
  rangeEnd: string;
  isBlocked: (ymd: string) => boolean;
  dayStatus: (ymd: string) => { disabled: boolean; checkoutOnly: boolean };
  onPick: (ymd: string) => void;
  onHover: (ymd: string | null) => void;
}) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = new Date(year, month, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex-1">
      <div className="mb-3 text-center text-sm font-semibold">{monthLabel}</div>
      <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const ymd = `${year}-${pad(month + 1)}-${pad(i + 1)}`;
          const isPast = ymd < today;
          const blockedDay = isBlocked(ymd);
          const { disabled, checkoutOnly } = dayStatus(ymd);
          const isStart = checkIn && ymd === checkIn;
          const isEnd = rangeEnd && ymd === rangeEnd;
          const inRange =
            checkIn && rangeEnd && ymd > checkIn && ymd < rangeEnd;
          const isEndpoint = isStart || isEnd;

          return (
            <div
              key={ymd}
              className={cn(
                "aspect-square p-0.5",
                (inRange || (isEndpoint && rangeEnd)) && "bg-muted",
                isStart && rangeEnd && "rounded-l-full",
                isEnd && "rounded-r-full"
              )}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(ymd)}
                onMouseEnter={() => {
                  if (!disabled) onHover(ymd);
                }}
                onMouseLeave={() => onHover(null)}
                title={checkoutOnly && !isEndpoint ? "Checkout only" : undefined}
                className={cn(
                  "flex h-full w-full items-center justify-center rounded-full text-sm transition-colors",
                  isEndpoint && "bg-foreground font-semibold text-background",
                  !isEndpoint && !disabled && "hover:border hover:border-foreground",
                  blockedDay && disabled && "text-muted-foreground/40 line-through",
                  checkoutOnly && !isEndpoint && "text-foreground underline decoration-dotted underline-offset-4",
                  isPast && !blockedDay && "text-muted-foreground/30"
                )}
              >
                {i + 1}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
