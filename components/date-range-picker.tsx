"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, CalendarDays, X } from "lucide-react";
import { cn, prefersReducedMotion, scrollBehavior } from "@/lib/utils";
import {
  dayHint,
  getDayAvailability,
  nextRangeSelection,
  type DateRange,
  type DayAvailability,
} from "@/lib/dates";
import { useOverlayHistory } from "@/lib/use-overlay-history";

// Airbnb-style "When" range picker: a single trigger that opens a calendar.
// Click a start date, then an end date; the range highlights and the picker
// auto-applies (closes) once both are chosen. On phones the calendar opens as a
// CENTRED overlay with a dim backdrop; from `sm` up it stays anchored under the
// trigger. Values are "yyyy-mm-dd" strings.

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
/** Media probe — only ever called from effects & handlers (client-side). */
function isAnchoredLayout(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
}

/**
 * `true` only below `sm`, i.e. exactly when the calendar renders as the fixed,
 * centred fullscreen overlay rather than an anchored dropdown. Starts `false`
 * so SSR and the first client render agree (same pattern as
 * `useIsCompactLayout` in booking-context).
 */
function useIsFullscreenOverlay(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639.98px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return compact;
}

export function DateRangePicker({
  checkIn,
  checkOut,
  onChange,
  variant = "bar",
  align = "left",
  blockedRanges = [],
  allowBlocked = false,
  allowPast = false,
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
  /**
   * Admin override mode: blocked dates stay SELECTABLE (shown struck-through in
   * amber) instead of disabled, so an admin can deliberately pick occupied dates
   * and override them. Guests never get this.
   */
  allowBlocked?: boolean;
  /** Admin mode: allow selecting past dates (e.g. recording a stay that already
   * happened). Guests never get this. */
  allowPast?: boolean;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? (openProp as boolean) : openState;
  const setOpen = useCallback(
    (v: boolean) => {
      onOpenChange?.(v);
      if (!controlled) setOpenState(v);
    },
    [controlled, onOpenChange]
  );

  // Below `sm` the calendar is a fullscreen overlay that *feels* like a page,
  // so the device Back gesture has to dismiss it rather than navigate off the
  // listing (which would lose the scroll position and the chosen dates). On
  // `sm`+ it's an anchored dropdown, where hijacking Back would be surprising —
  // hence the same media gate that chooses the presentation. Closing this way
  // only hides the picker; the selection is left exactly as it was, like an
  // outside click.
  const isFullscreenOverlay = useIsFullscreenOverlay();
  const close = useCallback(() => setOpen(false), [setOpen]);
  useOverlayHistory(open, close, { enabled: isFullscreenOverlay });

  const [hovered, setHovered] = useState<Date | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const start = parseYmd(checkIn);
  const end = parseYmd(checkOut);
  const today = startOfToday();
  const nights = nightsBetween(checkIn, checkOut);

  // Booked ranges as date-only DateRanges (half-open [start, end)). Built once
  // from the "yyyy-mm-dd" prefixes so the picker and the server's booking
  // validation reason about exactly the same nights.
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

  // Availability of a single day, delegated to the one shared rule in
  // `lib/dates.ts` so this picker, the on-page availability calendar and the
  // server's booking validation can never drift apart. Crucially a free night
  // that simply can't be reached as a checkout (because booked nights sit in
  // between) comes back as `restart` — dimmed but still CLICKABLE, so clicking
  // it starts a new trip there instead of silently swallowing the tap.
  function dayStatus(day: Date): DayAvailability {
    return getDayAvailability(day, {
      checkIn: start,
      checkOut: end,
      blocks: blockDates,
      today,
      allowBlocked,
      allowPast,
    });
  }

  const [view, setView] = useState(() => {
    const base = start ?? today;
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  // Which way the month grid should slide when paging.
  const [dir, setDir] = useState<1 | -1>(1);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      // The fullscreen overlay is portalled to <body>, so it isn't inside
      // `ref` — check it separately or every tap inside it would close.
      if (ref.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
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

  // Reopening jumps back to the month the trip starts in, so the selection is
  // always on screen instead of wherever the guest last paged to.
  useEffect(() => {
    if (!open || !start) return;
    setDir(1);
    setView({ year: start.getFullYear(), month: start.getMonth() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Settle the ANCHORED popover into view once its entrance animation has
  // finished — scrolling mid-animation is what made it lurch. The mobile
  // overlay is already centred in the viewport, so it never scrolls.
  useEffect(() => {
    if (!open || !isAnchoredLayout()) return;
    const reduce = prefersReducedMotion();
    const t = setTimeout(
      () => {
        popoverRef.current?.scrollIntoView({
          behavior: scrollBehavior(true),
          block: "nearest",
        });
      },
      reduce ? 0 : 220
    );
    return () => clearTimeout(t);
  }, [open]);

  // Lock the page behind the mobile overlay so the backdrop doesn't scroll away
  // under the guest's thumb while they pick dates.
  //
  // `overflow: hidden` alone isn't enough: it leaves the document scrollable on
  // iOS Safari, and elsewhere it collapses the scrollable area so the browser
  // clamps the offset to 0 — which is why finishing a selection used to dump
  // the guest back at the top of the listing. Taking the body out of flow at a
  // negative offset holds the view exactly where it was, and the position is
  // put back by hand on the way out.
  useEffect(() => {
    if (!open || isAnchoredLayout()) return;
    const body = document.body;
    const offsetY = window.scrollY;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${offsetY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    return () => {
      Object.assign(body.style, previous);
      // `scroll-behavior: smooth` is set globally, so an unguarded scrollTo
      // would animate the restore and lose a race with whatever the panel
      // scrolls to next. The restore has to land on this frame.
      const root = document.documentElement;
      const behavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(0, offsetY);
      root.style.scrollBehavior = behavior;
    };
  }, [open]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  function pick(day: Date) {
    const status = dayStatus(day);
    if (status.disabled) return;
    // Tapping the pending check-in again clears the trip — there is always a
    // visible way out of a half-finished selection.
    if (status.clearsSelection) {
      setHovered(null);
      onChange("", "");
      return;
    }
    // Shared, tested transition — identical to the on-page calendar & server.
    // In admin override mode we ignore block constraints so any chronological
    // range can be chosen (occupied dates included).
    const next = nextRangeSelection(
      { checkIn: start, checkOut: end },
      day,
      allowBlocked ? [] : blockDates
    );
    if (!next) return;
    onChange(
      next.checkIn ? toYmd(next.checkIn) : "",
      next.checkOut ? toYmd(next.checkOut) : ""
    );
    if (next.checkOut) {
      setHovered(null);
      // Hold the popover open for a beat so the completed range visibly fills
      // in before it eases away — closing on the same frame reads as a flicker.
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setOpen(false), prefersReducedMotion() ? 0 : 200);
    }
  }

  function clear() {
    setHovered(null);
    onChange("", "");
  }

  function shift(delta: number) {
    setDir(delta > 0 ? 1 : -1);
    setView((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  let label = "Add dates";
  if (checkIn && checkOut) label = `${fmtLabel(checkIn)} – ${fmtLabel(checkOut)}`;
  else if (checkIn) label = `${fmtLabel(checkIn)} – End date`;

  const card = variant === "card";
  const helper =
    nights > 0
      ? `${nights} night${nights > 1 ? "s" : ""} selected`
      : checkIn
        ? // Clicking an earlier day silently restarts the range, which reads as
          // the picker resetting itself. Say which way to go.
          `Now pick a checkout after ${fmtLabel(checkIn)}`
        : "Select your check-in date";

  // The fullscreen overlay is portalled to <body> so a transformed ancestor
  // (the sticky booking card, a sheet, an animated wrapper) can never turn its
  // `position: fixed` centring into "centred inside that ancestor". The
  // anchored desktop popover stays inline, next to its trigger.
  //
  // Being outside the tree has two consequences when the trigger lives inside a
  // Radix modal (the mobile Filters sheet), both handled on the wrapper below:
  // that modal sets `pointer-events: none` on <body>, which the portal would
  // otherwise inherit and become untappable; and it is "outside" as far as the
  // modal's dismiss-on-outside-click is concerned, so the wrapper is tagged
  // `data-nested-overlay` for SheetContent/DialogContent to recognise.
  const portal = (node: ReactNode) =>
    isFullscreenOverlay && typeof document !== "undefined"
      ? createPortal(node, document.body)
      : node;

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
            : "min-w-0 flex-1 rounded-full px-4 py-1"
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

      {open && portal(
        // Phones: a centred overlay with a dim backdrop (the old right-anchored
        // ~100vw popover hung off-screen inside the narrow booking card).
        // `sm:contents` dissolves this wrapper from `sm` up, so the calendar
        // goes back to being anchored under the trigger exactly as before.
        <div
          data-nested-overlay=""
          className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center p-3 sm:contents"
        >
          <button
            type="button"
            aria-label="Close calendar"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/40 duration-200 ease-ios animate-in fade-in motion-reduce:animate-none sm:hidden"
          />
          <div
            ref={popoverRef}
            role="dialog"
            aria-modal="true"
            aria-label="Select dates"
            className={cn(
              "relative z-10 flex max-h-[88vh] w-full max-w-[400px] flex-col overflow-y-auto overscroll-contain rounded-3xl border bg-white p-4 shadow-2xl duration-200 ease-ios animate-in fade-in zoom-in-95 slide-in-from-bottom-2 motion-reduce:animate-none",
              "sm:absolute sm:top-full sm:z-50 sm:mt-3 sm:max-h-none sm:w-auto sm:max-w-[760px] sm:overflow-visible sm:p-6 sm:shadow-xl sm:slide-in-from-top-1",
              align === "right" ? "sm:right-0" : "sm:left-0"
            )}
          >
            <div className="mb-3 flex items-center justify-between sm:hidden">
              <span className="text-base font-semibold">Select dates</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close calendar"
                className="-mr-1 rounded-full p-2 text-muted-foreground transition-[background-color,transform] duration-150 ease-ios active:scale-90 active:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100 [@media(hover:hover)]:hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => shift(-1)}
                className="absolute left-0 top-0 z-10 rounded-full p-2 transition-[background-color,transform] duration-150 ease-ios active:scale-90 active:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100 [@media(hover:hover)]:hover:bg-muted"
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

              {/* Re-keyed on every page so the grids slide in from the side the
                  guest paged towards instead of blinking into place. */}
              <div className="overflow-hidden">
                <div
                  key={`${view.year}-${view.month}`}
                  className={cn(
                    "flex justify-center gap-10 duration-200 ease-ios animate-in fade-in motion-reduce:animate-none",
                    dir > 0 ? "slide-in-from-right-4" : "slide-in-from-left-4"
                  )}
                >
                  <Month
                    year={view.year}
                    month={view.month}
                    start={start}
                    end={end}
                    hovered={hovered}
                    today={today}
                    dayStatus={dayStatus}
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
                      dayStatus={dayStatus}
                      onPick={pick}
                      onHover={setHovered}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4 sm:mt-5">
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {helper}
              </span>
              <button
                type="button"
                onClick={clear}
                disabled={!checkIn && !checkOut}
                className="shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold underline underline-offset-4 transition-[background-color,color,transform] duration-150 ease-ios active:scale-95 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100 [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-brand"
              >
                Clear dates
              </button>
            </div>
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
  dayStatus,
  onPick,
  onHover,
}: {
  year: number;
  month: number;
  start: Date | null;
  end: Date | null;
  hovered: Date | null;
  today: Date;
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
    <div className="w-full select-none sm:w-[300px]">
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
        className="grid min-h-[264px] grid-cols-7 content-start sm:min-h-[240px]"
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
                "flex h-11 items-center justify-center transition-[background-color,border-radius] duration-150 ease-ios motion-reduce:transition-none sm:h-10",
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
                  // Chosen check-in / checkout — solid, filled caps.
                  isEndpoint && "bg-brand font-semibold text-white shadow-sm",
                  // Booked & genuinely unpickable.
                  status.kind === "blocked" &&
                    !isEndpoint &&
                    "cursor-not-allowed text-muted-foreground/40 line-through",
                  status.kind === "past" &&
                    !isEndpoint &&
                    "cursor-default text-muted-foreground/30",
                  // Admin override: occupied but still selectable → amber strike.
                  status.blockedNight &&
                    !status.disabled &&
                    !status.checkoutOnly &&
                    !isEndpoint &&
                    "text-amber-600 line-through decoration-amber-500/70",
                  // Booked night still valid as a checkout (same-day turnover).
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
