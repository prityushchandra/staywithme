"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Holds the dates/guests chosen in the homepage (or search) search bar, so the
// listing cards can carry them into the listing URL — clicking a stay then
// pre-populates its booking with the dates you already picked.
type SearchDates = {
  checkIn: string;
  checkOut: string;
  guests: number;
  setRange: (checkIn: string, checkOut: string) => void;
  setGuests: (n: number) => void;
  /** "checkIn=..&checkOut=..&guests=.." for appending to a listing link. */
  query: string;
};

const Ctx = createContext<SearchDates | null>(null);

export function SearchDatesProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial?: { checkIn?: string; checkOut?: string; guests?: number };
}) {
  const initialCheckIn = initial?.checkIn ?? "";
  const initialCheckOut = initial?.checkOut ?? "";
  const initialGuests = initial?.guests ?? 1;
  const [checkIn, setCheckIn] = useState(initialCheckIn);
  const [checkOut, setCheckOut] = useState(initialCheckOut);
  const [guests, setGuests] = useState(initialGuests);

  // Client-side searches reuse this provider; listing links must carry the
  // newly applied dates rather than the first search's dates.
  useEffect(() => {
    setCheckIn(initialCheckIn);
    setCheckOut(initialCheckOut);
    setGuests(initialGuests);
  }, [initialCheckIn, initialCheckOut, initialGuests]);

  const params = new URLSearchParams();
  if (checkIn) params.set("checkIn", checkIn);
  if (checkOut) params.set("checkOut", checkOut);
  if (guests > 1) params.set("guests", String(guests));

  return (
    <Ctx.Provider
      value={{
        checkIn,
        checkOut,
        guests,
        setRange: (ci, co) => {
          setCheckIn(ci);
          setCheckOut(co);
        },
        setGuests,
        query: params.toString(),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

/** Returns the search-dates context, or null when there's no provider. */
export function useSearchDates() {
  return useContext(Ctx);
}
