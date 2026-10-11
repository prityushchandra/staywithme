"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { nextRangeSelection, type DateRange } from "@/lib/dates";
import type { MissingTripField } from "@/lib/reserve-prompt";
import type { QuoteSnapshot } from "@/lib/quote-check";
import type { InquiryDetails } from "@/lib/whatsapp";

// Shared booking state so the on-page availability calendar and the sticky
// booking card stay in sync (like Airbnb — picking dates in either updates both).
// Dates are "yyyy-mm-dd" strings.
//
// It also carries the page's single Reserve call-to-action: the booking card
// owns the listing data, so it publishes the CTA here and whichever surface is
// active (the card on desktop, the floating tab on mobile) renders it. Without
// this both surfaces rendered their own Reserve button and the guest saw two.
//
// Finally it holds `liveListing` — the figures the Reserve re-check pulled
// straight from the database. The page itself is ISR-cached, so once we know
// better, that override wins over the props everywhere.

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseYmd(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** What the one Reserve button must do, in the order the card resolves it. */
export type ReserveCta = { label: string; shortLabel: string } & (
  /** Trip details are missing — tapping Reserve takes the guest to the dates. */
  | { kind: "incomplete"; missing: MissingTripField[] }
  /** The chosen nights are already booked. */
  | { kind: "unavailable" }
  /** Signed-out guest: send them to sign-in first. */
  | { kind: "login"; href: string }
  /** Everything is set — open WhatsApp with the pre-filled enquiry. */
  | {
      kind: "ready";
      whatsappNumber: string;
      details: InquiryDetails;
      /** What the card is quoting, so Reserve can re-check it live on click. */
      quote: QuoteSnapshot;
    }
);

/**
 * Server-fresh listing figures, fetched when the guest presses Reserve. The
 * page's props are ISR-cached, so whenever this is set it supersedes them
 * everywhere the booking surfaces read prices or blocked nights.
 */
export type LiveListingData = {
  basePrice: number;
  discountedPrice: number | null;
  monthlyPrice: number | null;
  platformFeePercent: number;
  blockedRanges: { startDate: string; endDate: string }[];
};

type BookingState = {
  checkIn: string;
  checkOut: string;
  guests: number; // adults
  infants: number;
  setRange: (checkIn: string, checkOut: string) => void;
  setGuests: (n: number) => void;
  setInfants: (n: number) => void;
  /** Range-aware single-date click used by the calendar (start, then end). */
  pickDate: (ymd: string) => void;
  /** True below Tailwind's `lg`, where the floating tab owns the Reserve CTA. */
  isCompactLayout: boolean;
  /** The single Reserve CTA, published by the booking card. */
  reserveCta: ReserveCta | null;
  setReserveCta: (cta: ReserveCta | null) => void;
  /** Shared so any surface can open the booking card's date picker. */
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  /** Live figures from the Reserve re-check; wins over the page's props. */
  liveListing: LiveListingData | null;
  setLiveListing: (next: LiveListingData | null) => void;
  /** Blocked ranges actually in force — the live ones when we have them. */
  blockedRanges: { startDate: string; endDate: string }[];
};

const BookingCtx = createContext<BookingState | null>(null);

// Matches Tailwind's `lg` breakpoint. Starts false so the server render and the
// first client render agree (desktop markup), then corrects after hydration.
function useIsCompactLayout(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return compact;
}

export function BookingProvider({
  children,
  initialCheckIn = "",
  initialCheckOut = "",
  initialGuests = 1,
  blockedRanges = [],
}: {
  children: React.ReactNode;
  initialCheckIn?: string;
  initialCheckOut?: string;
  initialGuests?: number;
  /** Booked/blocked ranges (start inclusive, end exclusive) to enforce. */
  blockedRanges?: { startDate: string; endDate: string }[];
}) {
  const [checkIn, setCheckIn] = useState(initialCheckIn);
  const [checkOut, setCheckOut] = useState(initialCheckOut);
  const [guests, setGuests] = useState(initialGuests);
  const [infants, setInfants] = useState(0);
  const [reserveCta, setReserveCta] = useState<ReserveCta | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [liveListing, setLiveListing] = useState<LiveListingData | null>(null);
  const isCompactLayout = useIsCompactLayout();

  // Once the Reserve re-check has told us what the server really holds, that
  // list is the one every surface (and the selection rule below) enforces.
  const effectiveRanges = liveListing?.blockedRanges ?? blockedRanges;

  const blockDates = useMemo<DateRange[]>(
    () =>
      effectiveRanges
        .map((b) => ({
          startDate: parseYmd(b.startDate.slice(0, 10)),
          endDate: parseYmd(b.endDate.slice(0, 10)),
        }))
        .filter((b): b is DateRange => b.startDate !== null && b.endDate !== null),
    [effectiveRanges]
  );

  function setRange(ci: string, co: string) {
    setCheckIn(ci);
    setCheckOut(co);
  }

  function pickDate(ymd: string) {
    const day = parseYmd(ymd);
    if (!day) return;
    // Delegate to the shared, tested selection rule so the on-page calendar
    // enforces the same availability (incl. Airbnb "checkout-only" turnover and
    // never spanning a booked night) as the booking card and the server.
    const next = nextRangeSelection(
      { checkIn: parseYmd(checkIn), checkOut: parseYmd(checkOut) },
      day,
      blockDates
    );
    if (!next) return; // click ignored (e.g. an occupied night as check-in)
    setCheckIn(next.checkIn ? toYmd(next.checkIn) : "");
    setCheckOut(next.checkOut ? toYmd(next.checkOut) : "");
  }

  return (
    <BookingCtx.Provider
      value={{
        checkIn,
        checkOut,
        guests,
        infants,
        setRange,
        setGuests,
        setInfants,
        pickDate,
        isCompactLayout,
        reserveCta,
        setReserveCta,
        pickerOpen,
        setPickerOpen,
        liveListing,
        setLiveListing,
        blockedRanges: effectiveRanges,
      }}
    >
      {children}
    </BookingCtx.Provider>
  );
}

export function useBooking() {
  const ctx = useContext(BookingCtx);
  if (!ctx) throw new Error("useBooking must be used within a BookingProvider");
  return ctx;
}
