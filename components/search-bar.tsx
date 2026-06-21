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
  initial?: { destination?: string; checkIn?: string; checkOut?: string; guests?: number; infants?: number };
}) {
  const router = useRouter();
  const searchDates = useSearchDates();
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [checkIn, setCheckIn] = useState(initial?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initial?.checkOut ?? "");
  const [guests, setGuests] = useState(initial?.guests ?? 1);
  const [infants, setInfants] = useState(initial?.infants ?? 0);

  function changeGuests(n: number) {
    const g = Math.max(1, Math.min(16, n));
    setGuests(g);
    searchDates?.setGuests(g);
  }
  function changeInfants(n: number) {
    setInfants(Math.max(0, Math.min(10, n)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (destination.trim()) params.set("destination", destination.trim());
    if (checkIn) params.set("checkIn", checkIn);
    if (checkOut) params.set("checkOut", checkOut);
    if (guests > 1) params.set("guests", String(guests));
    if (infants > 0) params.set("infants", String(infants));
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

      <GuestsField
        adults={guests}
        infants={infants}
        onChangeAdults={changeGuests}
        onChangeInfants={changeInfants}
        compact={compact}
      />

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

// Guests selector: shows "Add Guests" (no "Who" label); opens a panel with
// separate Adults and Infants steppers.
function GuestsField({
  adults,
  infants,
  onChangeAdults,
  onChangeInfants,
  compact,
}: {
  adults: number;
  infants: number;
  onChangeAdults: (n: number) => void;
  onChangeInfants: (n: number) => void;
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

  const hasGuests = adults > 1 || infants > 0;
  const summary = [
    `${adults} adult${adults === 1 ? "" : "s"}`,
    infants > 0 ? `${infants} infant${infants === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2.5 text-left",
          compact ? "px-4 py-0" : "px-4 py-3"
        )}
      >
        <Users className="h-5 w-5 shrink-0 text-brand" />
        <span
          className={cn(
            "truncate text-sm",
            hasGuests ? "font-medium text-foreground" : "text-muted-foreground"
          )}
        >
          {hasGuests ? summary : "Add Guests"}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-3 w-[19rem] max-w-[calc(100vw-2rem)] space-y-1 rounded-2xl border bg-white p-4 shadow-xl duration-150 animate-in fade-in zoom-in-95">
          <StepperRow
            label="Adults"
            value={adults}
            min={1}
            max={16}
            onChange={onChangeAdults}
          />
          <div className="border-t" />
          <StepperRow
            label="Infants"
            value={infants}
            min={0}
            max={10}
            onChange={onChangeInfants}
          />
        </div>
      )}
    </div>
  );
}

// Reusable −/value/+ row used inside the guests popover.
function StepperRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Fewer ${label.toLowerCase()}`}
          onClick={() => onChange(value - 1)}
          disabled={value <= min}
          className="grid h-9 w-9 place-items-center rounded-full border text-muted-foreground transition hover:border-foreground hover:text-foreground disabled:opacity-30 disabled:hover:border-border"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-6 text-center text-base font-medium tabular-nums">{value}</span>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          onClick={() => onChange(value + 1)}
          disabled={value >= max}
          className="grid h-9 w-9 place-items-center rounded-full border text-muted-foreground transition hover:border-foreground hover:text-foreground disabled:opacity-30 disabled:hover:border-border"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
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
