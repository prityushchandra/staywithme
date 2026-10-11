// Pure rules behind the live re-check that runs the moment a guest presses
// Reserve. The listing page is ISR-cached, so the price and blocked nights
// baked into the HTML can be minutes old — this decides what the fresh server
// answer means for the click that is already in flight.
//
// Kept DOM- and React-free so the decision can be unit-tested directly.

/** The price figures the booking card is showing right now. */
export type QuoteSnapshot = {
  /** Nightly rate, minor units (paise). */
  basePrice: number;
  /** Long-stay monthly rate, minor units, or null when the host set none. */
  monthlyPrice: number | null;
  platformFeePercent: number;
  /** Grand total for the selected stay, minor units. */
  total: number;
};

/** The authoritative answer from POST /api/listings/[id]/quote. */
export type FreshQuote = QuoteSnapshot & {
  available: boolean;
  nights: number;
  /** Current blocked/booked ranges, so the calendar can repaint immediately. */
  blockedRanges: { startDate: string; endDate: string }[];
};

export type QuoteOutcome =
  | { kind: "proceed" }
  | { kind: "unavailable"; message: string }
  | { kind: "price-changed"; message: string };

export const DATES_TAKEN_MESSAGE =
  "Those dates were just booked. Please choose new dates.";
export const PRICE_CHANGED_MESSAGE = "Prices have been updated.";

/**
 * What should happen to a Reserve click, given what the guest can see and what
 * the server says right now.
 *
 * Availability wins over price: a nudge about money is pointless when the
 * nights are gone. A price move only compares the three figures the card
 * actually shows — the stay total, the nightly rate and the monthly rate — so a
 * fee-percent tweak that leaves the total untouched never interrupts a booking.
 */
export function compareQuote(shown: QuoteSnapshot, fresh: FreshQuote): QuoteOutcome {
  if (!fresh.available) {
    return { kind: "unavailable", message: DATES_TAKEN_MESSAGE };
  }
  const priceMoved =
    fresh.total !== shown.total ||
    fresh.basePrice !== shown.basePrice ||
    (fresh.monthlyPrice ?? null) !== (shown.monthlyPrice ?? null);
  if (priceMoved) {
    return { kind: "price-changed", message: PRICE_CHANGED_MESSAGE };
  }
  return { kind: "proceed" };
}

function isRangeList(value: unknown): value is { startDate: string; endDate: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (r) =>
        !!r &&
        typeof r === "object" &&
        typeof (r as { startDate?: unknown }).startDate === "string" &&
        typeof (r as { endDate?: unknown }).endDate === "string"
    )
  );
}

/**
 * Narrow an untyped response body to a usable quote. Anything unexpected
 * returns null, which the caller treats as "couldn't check" and lets through —
 * a malformed reply must never cost a reservation.
 */
export function parseFreshQuote(data: unknown): FreshQuote | null {
  if (!data || typeof data !== "object") return null;
  const q = data as Record<string, unknown>;
  if (typeof q.available !== "boolean") return null;
  if (typeof q.total !== "number" || !Number.isFinite(q.total)) return null;
  if (typeof q.basePrice !== "number" || !Number.isFinite(q.basePrice)) return null;
  if (typeof q.platformFeePercent !== "number") return null;
  if (typeof q.nights !== "number") return null;
  const monthlyPrice = typeof q.monthlyPrice === "number" ? q.monthlyPrice : null;
  return {
    available: q.available,
    nights: q.nights,
    basePrice: q.basePrice,
    monthlyPrice,
    platformFeePercent: q.platformFeePercent,
    total: q.total,
    blockedRanges: isRangeList(q.blockedRanges) ? q.blockedRanges : [],
  };
}
