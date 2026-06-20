"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Minus, Plus, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/date-range-picker";
import { useSearchDates } from "@/components/search-dates-context";

// Airbnb-style search: destination · check-in · check-out · guests → /search.
// `variant="hero"` is the large homepage version; `variant="compact"` fits the
// header.
export function SearchBar({
  variant = "hero",
  initial,
}: {
  variant?: "hero" | "compact";
  initial?: { destination?: string; checkIn?: string; checkOut?: string; guests?: number };
}) {
  const router = useRouter();
  const searchDates = useSearchDates();
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [checkIn, setCheckIn] = useState(initial?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initial?.checkOut ?? "");
  const [guests, setGuests] = useState(initial?.guests ?? 1);

  function changeGuests(n: number) {
    const g = Math.max(1, Math.min(16, n));
    setGuests(g);
    searchDates?.setGuests(g);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (destination.trim()) params.set("destination", destination.trim());
    if (checkIn) params.set("checkIn", checkIn);
    if (checkOut) params.set("checkOut", checkOut);
    if (guests > 1) params.set("guests", String(guests));
    router.push(`/search?${params.toString()}`);
  }

  const compact = variant === "compact";

  return (
    <form
      onSubmit={submit}
      className={cn(
        "flex items-stretch border border-border bg-white",
        compact
          ? "h-11 rounded-full text-sm shadow-sm"
          : "flex-col gap-1 rounded-3xl p-3 shadow-xl ring-1 ring-black/5 sm:h-16 sm:flex-row sm:items-center sm:gap-0 sm:rounded-full sm:p-2"
      )}
    >
      {compact && (
        <>
          <Field label="Where" compact={compact}>
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Search destinations"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </Field>
          <Divider compact={compact} />
          <Field label="Check in" compact={compact}>
            <input
              type="date"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              className="w-full bg-transparent text-sm outline-none"
            />
          </Field>
          <Divider compact={compact} />
          <Field label="Check out" compact={compact}>
            <input
              type="date"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              className="w-full bg-transparent text-sm outline-none"
            />
          </Field>
        </>
      )}
      {!compact && (
        <DateRangePicker
          checkIn={checkIn}
          checkOut={checkOut}
          onChange={(ci, co) => {
            setCheckIn(ci);
            setCheckOut(co);
            searchDates?.setRange(ci, co);
          }}
        />
      )}
      <Divider compact={compact} />

      <GuestsField guests={guests} onChange={changeGuests} compact={compact} />

      <button
        type="submit"
        aria-label="Search"
        className={cn(
          "flex shrink-0 items-center justify-center gap-2 rounded-full bg-brand-gradient font-medium text-white transition hover:brightness-110",
          compact ? "m-1 h-9 w-9" : "m-1 h-12 px-5 sm:w-12 sm:px-0"
        )}
      >
        <Search className="h-4 w-4" />
        {!compact && <span className="sm:hidden">Search</span>}
      </button>
    </form>
  );
}

// Clean guests selector: shows a summary; opens a small panel with a stepper.
function GuestsField({
  guests,
  onChange,
  compact,
}: {
  guests: number;
  onChange: (n: number) => void;
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = `${guests} guest${guests === 1 ? "" : "s"}`;

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full flex-col justify-center text-left",
          compact ? "px-4 py-0" : "px-4 py-1"
        )}
      >
        {!compact && (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Who
          </span>
        )}
        <span className="flex items-center gap-1.5 text-sm">
          {compact && <Users className="h-4 w-4 text-muted-foreground" />}
          <span className={cn(guests > 1 ? "text-foreground" : "text-muted-foreground")}>
            {guests > 1 ? label : "Add guests"}
          </span>
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-3 w-[18rem] max-w-[calc(100vw-2rem)] rounded-2xl border bg-white p-4 shadow-xl duration-150 animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Guests</p>
              <p className="text-xs text-muted-foreground">How many are staying?</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Fewer guests"
                onClick={() => onChange(guests - 1)}
                disabled={guests <= 1}
                className="grid h-9 w-9 place-items-center rounded-full border text-muted-foreground transition hover:border-foreground hover:text-foreground disabled:opacity-30 disabled:hover:border-border"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-6 text-center text-base font-medium tabular-nums">
                {guests}
              </span>
              <button
                type="button"
                aria-label="More guests"
                onClick={() => onChange(guests + 1)}
                disabled={guests >= 16}
                className="grid h-9 w-9 place-items-center rounded-full border text-muted-foreground transition hover:border-foreground hover:text-foreground disabled:opacity-30 disabled:hover:border-border"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  compact,
  children,
}: {
  label: string;
  compact: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col justify-center px-4",
        compact ? "py-0" : "py-1"
      )}
    >
      {!compact && (
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

function Divider({ compact }: { compact: boolean }) {
  if (compact) return <div className="my-2 w-px self-stretch bg-border" />;
  // Hero: a horizontal rule between stacked fields on mobile, vertical on desktop.
  return (
    <div className="mx-2 h-px bg-border sm:mx-0 sm:my-3 sm:h-auto sm:w-px sm:self-stretch" />
  );
}
