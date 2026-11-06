// Pure rules behind the live re-check that runs the moment a guest presses
// Reserve. The listing page is ISR-cached, so the price and blocked nights
// baked into the HTML can be minutes old — this decides what the fresh server
// answer means for the click that is already in flight.
//
// Kept DOM- and React-free so the decision can be unit-tested directly.

import { meetsMinimumStay, minimumStayMessage } from "./pricing";

/** The price figures the booking card is showing right now. */
export type QuoteSnapshot = {
  /** Nightly LIST rate, minor units (paise) — before any discount. */
  basePrice: number;
  /** Nightly sale rate, minor units, or null when the listing isn't discounted. */
  discountedPrice: number | null;
  /** Long-stay monthly rate, minor units, or null when the host set none. */
  monthlyPrice: number | null;
  minimumNights: number | null;
  monthlyStayDiscount: number | null;
  platformFeePercent: number;
  /** Grand total for the selected stay, minor units. */
  total: number;
};

/** The authoritative answer from POST /api/listings/[id]/quote. */
export type FreshQuote = Omit<QuoteSnapshot, "total"> & {
  /** No price is offered for a stay below the current minimum. */
  total: number | null;
  available: boolean;
  nights: number;
  /** Current blocked/booked ranges, so the calendar can repaint immediately. */
  blockedRanges: { startDate: string; endDate: string }[];
};

export type QuoteOutcome =
  | { kind: "proceed" }
  | { kind: "unavailable"; message: string }
  | { kind: "minimum-stay"; message: string }
  | { kind: "check-failed"; message: string }
  | { kind: "price-changed"; message: string };

export const DATES_TAKEN_MESSAGE =
  "Those dates were just booked. Please choose new dates.";
export const PRICE_CHANGED_MESSAGE = "Prices have been updated.";
export const QUOTE_CHECK_FAILED_MESSAGE =
  "We couldn't check the latest booking terms. Please try again before reserving.";

/**
 * What should happen to a Reserve click, given what the guest can see and what
 * the server says right now.
 *
 * Availability wins over price: a nudge about money is pointless when the
 * nights are gone. A price move only compares the figures the card actually
 * shows — the stay total, the nightly list and sale rates, and the monthly rate
 * — so a fee-percent tweak that leaves the total untouched never interrupts a
 * booking.
 */
export function compareQuote(shown: QuoteSnapshot, fresh: FreshQuote): QuoteOutcome {
  if (!fresh.available) {
    return { kind: "unavailable", message: DATES_TAKEN_MESSAGE };
  }
  if (!meetsMinimumStay(fresh.nights, fresh.minimumNights)) {
    return {
      kind: "minimum-stay",
      message: `${minimumStayMessage(fresh.minimumNights ?? 1)}. Please choose a longer stay.`,
    };
  }
  const priceMoved =
    fresh.total !== shown.total ||
    fresh.basePrice !== shown.basePrice ||
    (fresh.discountedPrice ?? null) !== (shown.discountedPrice ?? null) ||
    (fresh.monthlyPrice ?? null) !== (shown.monthlyPrice ?? null) ||
    (fresh.monthlyStayDiscount ?? null) !== (shown.monthlyStayDiscount ?? null);
  if (priceMoved) {
    return { kind: "price-changed", message: PRICE_CHANGED_MESSAGE };
  }
  if ((fresh.minimumNights ?? null) !== (shown.minimumNights ?? null)) {
    return { kind: "price-changed", message: "Minimum booking nights have been updated." };
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
 * returns null, which the caller reports explicitly and requires a retry for.
 */
export function parseFreshQuote(data: unknown): FreshQuote | null {
  if (!data || typeof data !== "object") return null;
  const q = data as Record<string, unknown>;
  if (typeof q.available !== "boolean") return null;
  if (typeof q.basePrice !== "number" || !Number.isFinite(q.basePrice)) return null;
  if (typeof q.platformFeePercent !== "number" || !Number.isFinite(q.platformFeePercent)) return null;
  if (typeof q.nights !== "number" || !Number.isInteger(q.nights) || q.nights < 1) return null;
  if (q.minimumNights != null && (
    typeof q.minimumNights !== "number" || !Number.isInteger(q.minimumNights) ||
    q.minimumNights < 1 || q.minimumNights > 365
  )) return null;
  if (q.monthlyStayDiscount != null && (
    typeof q.monthlyStayDiscount !== "number" || !Number.isSafeInteger(q.monthlyStayDiscount) ||
    q.monthlyStayDiscount < 0
  )) return null;
  const minimumNights = typeof q.minimumNights === "number" ? q.minimumNights : null;
  const monthlyStayDiscount = typeof q.monthlyStayDiscount === "number" ? q.monthlyStayDiscount : null;
  if (q.total === null) {
    if (meetsMinimumStay(q.nights, minimumNights)) return null;
  } else if (typeof q.total !== "number" || !Number.isFinite(q.total) || q.total < 0) {
    return null;
  }
  const monthlyPrice = typeof q.monthlyPrice === "number" ? q.monthlyPrice : null;
  const discountedPrice = typeof q.discountedPrice === "number" ? q.discountedPrice : null;
  return {
    available: q.available,
    nights: q.nights,
    basePrice: q.basePrice,
    discountedPrice,
    monthlyPrice,
    minimumNights,
    monthlyStayDiscount,
    platformFeePercent: q.platformFeePercent,
    total: q.total,
    blockedRanges: isRangeList(q.blockedRanges) ? q.blockedRanges : [],
  };
}
