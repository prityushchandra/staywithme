"use client";

import { useMemo } from "react";
import { ReserveButton } from "@/components/reserve-button";
import { useBooking } from "@/components/booking-context";
import { computePricing, computeStayBase, isMonthlyRate, formatINR } from "@/lib/pricing";
import { isRangeAvailable, toUtcDate } from "@/lib/dates";

// Floating booking tab on mobile (hidden on desktop, where the sticky card is
// used). It renders the page's single Reserve button — published by the booking
// card, which hides its own copy on compact screens — so the guest only ever
// sees one Reserve CTA.
//
// Like the card, it prefers the live figures from the Reserve re-check over the
// ISR-cached props whenever they exist, so both surfaces always agree.
export function MobileBookingBar({
  basePrice: basePriceProp,
  monthlyPrice: monthlyPriceProp,
  platformFeePercent: platformFeePercentProp,
  blockedRanges: blockedRangesProp = [],
}: {
  basePrice: number;
  monthlyPrice?: number | null;
  platformFeePercent: number;
  blockedRanges?: { startDate: string; endDate: string }[];
}) {
  const { checkIn, checkOut, guests, infants, isCompactLayout, reserveCta, liveListing } =
    useBooking();
  const basePrice = liveListing?.basePrice ?? basePriceProp;
  const monthlyPrice = liveListing ? liveListing.monthlyPrice : monthlyPriceProp;
  const platformFeePercent = liveListing?.platformFeePercent ?? platformFeePercentProp;
  const blockedRanges = liveListing?.blockedRanges ?? blockedRangesProp;
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

  // Only mount on compact screens: on desktop the booking card owns the Reserve
  // button, and rendering both is what used to put two Reserve buttons on screen.
  if (!isCompactLayout || !reserveCta) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)] lg:hidden">
      <div className="pointer-events-auto mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white/95 px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.18)] backdrop-blur">
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

        <ReserveButton cta={reserveCta} className="h-11 shrink-0 px-5 text-sm" />
      </div>
    </div>
  );
}
