"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { nextRangeSelection, type DateRange } from "@/lib/dates";

// Shared booking state so the on-page availability calendar and the sticky
// booking card stay in sync (like Airbnb — picking dates in either updates both).
// Dates are "yyyy-mm-dd" strings.

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
};

const BookingCtx = createContext<BookingState | null>(null);

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
      value={{ checkIn, checkOut, guests, infants, setRange, setGuests, setInfants, pickDate }}
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
