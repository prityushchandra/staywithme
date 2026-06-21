"use client";

import { useMemo } from "react";
import { useBooking } from "@/components/booking-context";
import { computePricing, computeStayBase, isMonthlyRate, formatINR } from "@/lib/pricing";
import { isRangeAvailable, toUtcDate } from "@/lib/dates";

// Fixed bottom bar on mobile (hidden on desktop, where the sticky card is used).
// Shows the price and a "Reserve" CTA that scrolls up to the booking card, where
// the actual request-to-book / login happens.
export function MobileBookingBar({
  basePrice,
  monthlyPrice,
  platformFeePercent,
  blockedRanges = [],
}: {
  basePrice: number;
  monthlyPrice?: number | null;
  platformFeePercent: number;
  blockedRanges?: { startDate: string; endDate: string }[];
}) {
  const { checkIn, checkOut, guests, infants } = useBooking();
  const hasDates =
    Boolean(checkIn && checkOut) &&
    new Date(checkOut).getTime() > new Date(checkIn).getTime();

  const nights = useMemo(() => {
    if (!hasDates) return 0;
    const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
    return Math.max(1, Math.round(ms / 86_400_000));
  }, [hasDates, checkIn, checkOut]);

  const available = useMemo(() => {
    if (!hasDates) return false;
    const blocks = blockedRanges.map((b) => ({
      startDate: new Date(b.startDate),
      endDate: new Date(b.endDate),
    }));
    return isRangeAvailable(toUtcDate(checkIn), toUtcDate(checkOut), blocks);
  }, [hasDates, checkIn, checkOut, blockedRanges]);

  const n = nights || 1;
  const monthly = isMonthlyRate(monthlyPrice, n);
  const total = computePricing(computeStayBase(basePrice, monthlyPrice, n), { platformFeePercent }).total;
  const nightlyTotal = computePricing(basePrice * n, { platformFeePercent }).total;

  function scrollToBook() {
    document
      .getElementById("book")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {hasDates && available ? (
            <>
              <div className="text-sm font-semibold">
                {monthly && nightlyTotal > total ? (
                  <span className="mr-1 font-normal text-muted-foreground line-through">
                    {formatINR(nightlyTotal)}
                  </span>
                ) : null}
                {formatINR(total)}{" "}
                <span className="font-normal text-muted-foreground">total</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {nights} night{nights > 1 ? "s" : ""} · {guests} adult
                {guests > 1 ? "s" : ""}
                {infants > 0 ? ` · ${infants} infant${infants > 1 ? "s" : ""}` : ""}
                {monthly ? " · monthly rate" : ""}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold">
                {formatINR(basePrice)}{" "}
                <span className="font-normal text-muted-foreground">/ night</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {hasDates ? "Dates unavailable" : "Add dates to reserve"}
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={scrollToBook}
          className="shrink-0 rounded-lg bg-brand-gradient px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.97]"
        >
          Reserve
        </button>
      </div>
    </div>
  );
}
