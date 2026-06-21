"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

// Airbnb-style "When" range picker: a single trigger that opens a calendar
// popover. Click a start date, then an end date; the range highlights and the
// picker auto-applies (closes) once both are chosen. Booked & past dates are
// disabled. Values are "yyyy-mm-dd" strings.

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseYmd(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function fmtLabel(s: string): string {
  const d = parseYmd(s);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
}
function nightsBetween(ci: string, co: string): number {
  const a = parseYmd(ci);
  const b = parseYmd(co);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function DateRangePicker({
  checkIn,
  checkOut,
  onChange,
  variant = "bar",
  align = "left",
  blockedRanges = [],
  open: openProp,
  onOpenChange,
}: {
  checkIn: string;
  checkOut: string;
  onChange: (checkIn: string, checkOut: string) => void;
  /** "bar" = pill for the search bar; "card" = bordered box for the booking panel. */
  variant?: "bar" | "card";
  /** Which edge the popover anchors to (use "right" inside a right-hand panel). */
  align?: "left" | "right";
  /** Booked ranges (start inclusive, end exclusive) to disable. */
  blockedRanges?: { startDate: string; endDate: string }[];
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp !== undefined ? openProp : openState;
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (openProp === undefined) setOpenState(v);
  };

  const [hovered, setHovered] = useState<Date | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const start = parseYmd(checkIn);
  const end = parseYmd(checkOut);
  const today = startOfToday();
  const nights = nightsBetween(checkIn, checkOut);

  const blocked = useMemo(
    () =>
      blockedRanges.map((b) => ({
        start: b.startDate.slice(0, 10),
        end: b.endDate.slice(0, 10),
      })),
    [blockedRanges]
  );
  const isBlocked = (d: Date) => {
    const ymd = toYmd(d);
    return blocked.some((b) => ymd >= b.start && ymd < b.end);
  };
  // True if any night in [s, e) is booked (so the range can't be selected).
  function rangeHasBlocked(s: Date, e: Date) {
    const t = new Date(s);
    while (t < e) {
      if (isBlocked(t)) return true;
      t.setDate(t.getDate() + 1);
    }
    return false;
  }

  const [view, setView] = useState(() => {
    const base = start ?? today;
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      // Capture phase + stopPropagation so closing the calendar with Escape
      // doesn't also bubble up and close a surrounding dialog/sheet.
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // When the calendar opens, auto-scroll it fully into view so dates are easy
  // to pick without manually scrolling the page.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      popoverRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 20);
    return () => clearTimeout(t);
  }, [open]);

  function pick(day: Date) {
    if (isBlocked(day)) return;
    if (!start || (start && end)) {
      onChange(toYmd(day), "");
      return;
    }
    if (day.getTime() <= start.getTime()) {
      onChange(toYmd(day), "");
      return;
    }
    // Choosing the end: reject a range that spans a booked night — restart instead.
    if (rangeHasBlocked(start, day)) {
      onChange(toYmd(day), "");
      return;
    }
    onChange(checkIn, toYmd(day));
    setHovered(null);
    setOpen(false); // auto-apply once a full range is chosen
  }

  function shift(delta: number) {
    setView((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  let label = "Add dates";
  if (checkIn && checkOut) label = `${fmtLabel(checkIn)} – ${fmtLabel(checkOut)}`;
  else if (checkIn) label = `${fmtLabel(checkIn)} – End date`;

  const card = variant === "card";

  return (
    <div
      ref={ref}
      className={cn("relative", card ? "w-full" : "flex min-w-0 flex-1 items-stretch")}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2.5 text-left transition-colors",
          card
            ? "w-full rounded-xl border px-4 py-3 hover:border-foreground"
            : cn(
                "min-w-0 flex-1 rounded-full px-4 py-1",
                open ? "bg-muted ring-1 ring-border" : "hover:bg-muted/60"
              )
        )}
      >
        <CalendarDays className="h-5 w-5 shrink-0 text-brand" />
        <span
          className={cn(
            "truncate text-sm",
            checkIn ? "font-medium text-foreground" : "text-muted-foreground"
          )}
        >
          {label}
          {nights > 0 && (
            <span className="font-normal text-muted-foreground">
              {"  ·  "}
              {nights} night{nights > 1 ? "s" : ""}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={cn(
            "absolute top-full z-50 mt-3 w-[calc(100vw-2rem)] max-w-[720px] rounded-3xl border bg-white p-5 shadow-xl duration-200 ease-ios animate-in fade-in zoom-in-95 slide-in-from-top-1 sm:w-auto sm:p-6",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          <div className="relative">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="absolute left-0 top-0 rounded-full p-2 hover:bg-muted"
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

            <div className="flex justify-center gap-10">
              <Month
                year={view.year}
                month={view.month}
                start={start}
                end={end}
                hovered={hovered}
                today={today}
                isBlocked={isBlocked}
                onPick={pick}
                onHover={setHovered}
              />
              <div className="hidden sm:block">
                <Month
                  year={view.month === 11 ? view.year + 1 : view.year}
                  month={(view.month + 1) % 12}
                  start={start}
                  end={end}
                  hovered={hovered}
                  today={today}
                  isBlocked={isBlocked}
                  onPick={pick}
                  onHover={setHovered}
                />
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">
              {nights > 0
                ? `${nights} night${nights > 1 ? "s" : ""} selected`
                : "Select your dates"}
            </span>
            <button
              type="button"
              onClick={() => {
                onChange("", "");
                setHovered(null);
              }}
              className="text-sm font-semibold underline underline-offset-2 hover:text-brand"
            >
              Clear dates
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Month({
  year,
  month,
  start,
  end,
  hovered,
  today,
  isBlocked,
  onPick,
  onHover,
}: {
  year: number;
  month: number;
  start: Date | null;
  end: Date | null;
  hovered: Date | null;
  today: Date;
  isBlocked: (d: Date) => boolean;
  onPick: (d: Date) => void;
  onHover: (d: Date | null) => void;
}) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = new Date(year, month, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const rangeEnd =
    end ?? (start && hovered && hovered.getTime() > start.getTime() ? hovered : null);

  const cells = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
    [year, month, daysInMonth]
  );

  return (
    <div className="w-[300px]">
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
        {cells.map((day) => {
          const t = day.getTime();
          const isPast = t < today.getTime();
          const blockedDay = isBlocked(day);
          const disabled = isPast || blockedDay;
          const isStart = start && t === start.getTime();
          const isEnd = rangeEnd && t === rangeEnd.getTime();
          const inRange = start && rangeEnd && t > start.getTime() && t < rangeEnd.getTime();
          const isEndpoint = isStart || isEnd;

          return (
            <div
              key={t}
              className={cn(
                "aspect-square p-0.5",
                (inRange || (isEndpoint && rangeEnd)) && "bg-brand/10",
                isStart && rangeEnd && "rounded-l-full",
                isEnd && "rounded-r-full"
              )}
            >
              <button
                type="button"
                disabled={!!disabled}
                onClick={() => onPick(day)}
                onMouseEnter={() => onHover(day)}
                className={cn(
                  "flex h-full w-full items-center justify-center rounded-full text-sm transition-colors",
                  isEndpoint && "bg-brand font-semibold text-white",
                  !disabled && !isEndpoint && "hover:border hover:border-foreground",
                  blockedDay && "text-muted-foreground/40 line-through",
                  isPast && !blockedDay && "cursor-default text-muted-foreground/30"
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
