"use client";

import { createContext, useContext, useState } from "react";

// Shared booking state so the on-page availability calendar and the sticky
// booking card stay in sync (like Airbnb — picking dates in either updates both).
// Dates are "yyyy-mm-dd" strings.
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
}: {
  children: React.ReactNode;
  initialCheckIn?: string;
  initialCheckOut?: string;
  initialGuests?: number;
}) {
  const [checkIn, setCheckIn] = useState(initialCheckIn);
  const [checkOut, setCheckOut] = useState(initialCheckOut);
  const [guests, setGuests] = useState(initialGuests);
  const [infants, setInfants] = useState(0);

  function setRange(ci: string, co: string) {
    setCheckIn(ci);
    setCheckOut(co);
  }

  function pickDate(ymd: string) {
    // No start yet, or a full range exists -> begin a new range.
    if (!checkIn || (checkIn && checkOut)) {
      setCheckIn(ymd);
      setCheckOut("");
      return;
    }
    // Clicked on/before the start -> restart from here.
    if (ymd <= checkIn) {
      setCheckIn(ymd);
      setCheckOut("");
      return;
    }
    setCheckOut(ymd);
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
