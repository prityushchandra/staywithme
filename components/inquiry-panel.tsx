"use client";

import { useEffect, useMemo, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { DateRangePicker } from "@/components/date-range-picker";
import { PricingBreakdown } from "@/components/pricing-breakdown";
import { ReserveButton } from "@/components/reserve-button";
import { useBooking, type ReserveCta } from "@/components/booking-context";
import {
  computePricing,
  computeStayBase,
  formatINR,
  nightlyPrice,
  strikePrice,
} from "@/lib/pricing";
import {
  BOOKING_TAB_INSET,
  NAVBAR_INSET,
  SUMMARY_VISIBLE_THRESHOLD,
  isSufficientlyVisible,
  shouldRevealSummary,
  type MissingTripField,
} from "@/lib/reserve-prompt";
import { isRangeAvailable, toUtcDate } from "@/lib/dates";
import { cn, scrollBehavior } from "@/lib/utils";

// Sticky booking card. Dates & guests come from the shared booking context, so
// it stays in sync with the on-page availability calendar. It also resolves the
// page's single "Reserve" action and publishes it to the context — on mobile the
// floating booking tab renders that one button instead of this card, so there is
// never a second Reserve button on screen.
//
// Prices and blocked nights arrive as props from the ISR-cached page, but the
// live re-check behind Reserve can replace them mid-session; whenever it has,
// the context's override is what this card displays and quotes.
export function InquiryPanel({
  propertyId,
  refCode,
  propertyName,
  basePrice: basePriceProp,
  discountedPrice: discountedPriceProp,
  monthlyPrice: monthlyPriceProp,
  platformFeePercent: platformFeePercentProp,
  maxGuests,
  maxInfants = 0,
  whatsappNumber,
  guestName,
  guestPhone,
  checkInTime,
  checkOutTime,
  blockedRanges: blockedRangesProp = [],
  isAuthenticated = false,
}: {
  propertyId: string;
  refCode?: string;
  propertyName: string;
  basePrice: number;
  discountedPrice?: number | null;
  monthlyPrice?: number | null;
  platformFeePercent: number;
  maxGuests: number;
  maxInfants?: number;
  whatsappNumber: string;
  guestName?: string;
  guestPhone?: string;
  checkInTime?: string;
  checkOutTime?: string;
  blockedRanges?: { startDate: string; endDate: string }[];
  isAuthenticated?: boolean;
}) {
  const {
    checkIn,
    checkOut,
    guests,
    infants,
    setRange,
    setGuests,
    setInfants,
    isCompactLayout,
    pickerOpen,
    setPickerOpen,
    setReserveCta,
    liveListing,
  } = useBooking();
  const loginHref = `/sign-in?callbackUrl=${encodeURIComponent(`/listings/${propertyId}`)}`;

  // The page's props were baked in when the ISR page was last rendered. If the
  // Reserve re-check has since read the database, those fresher figures win —
  // so the breakdown the guest is looking at is the one they'll be quoted.
  const listPrice = liveListing?.basePrice ?? basePriceProp;
  const discountedPrice = liveListing
    ? liveListing.discountedPrice
    : discountedPriceProp ?? null;
  // The nightly rate actually charged, and the one to strike through (if any).
  const basePrice = nightlyPrice({ basePrice: listPrice, discountedPrice });
  const strike = strikePrice({ basePrice: listPrice, discountedPrice });
  const monthlyPrice = liveListing ? liveListing.monthlyPrice : monthlyPriceProp;
  const platformFeePercent = liveListing?.platformFeePercent ?? platformFeePercentProp;
  const blockedRanges = liveListing?.blockedRanges ?? blockedRangesProp;

  // A valid stay needs checkout strictly after check-in (guards reversed/equal
  // dates that can arrive via stale URL params).
  const hasDates =
    Boolean(checkIn && checkOut) &&
    new Date(checkOut).getTime() > new Date(checkIn).getTime();

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 1;
    const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
    const n = Math.round(ms / (1000 * 60 * 60 * 24));
    return n > 0 ? n : 1;
  }, [checkIn, checkOut]);

  const datesUnavailable = useMemo(() => {
    if (!hasDates) return false;
    const blocks = blockedRanges.map((b) => ({
      startDate: new Date(b.startDate),
      endDate: new Date(b.endDate),
    }));
    return !isRangeAvailable(toUtcDate(checkIn), toUtcDate(checkOut), blocks);
  }, [hasDates, checkIn, checkOut, blockedRanges]);

  const total = computePricing(computeStayBase(basePrice, monthlyPrice, nights), {
    platformFeePercent,
  }).total;

  /** The guests + total block the guest is sent to once a stay is complete. */
  const summaryRef = useRef<HTMLDivElement>(null);
  /** Identifies a complete stay, so a changed one can be told from an unchanged one. */
  const rangeKey = hasDates ? `${checkIn}/${checkOut}` : "";
  /** The stay the card already held when the picker was opened. */
  const rangeAtOpen = useRef<string | null>(null);

  // The single Reserve action for the whole page, resolved here because this is
  // the only component with the full listing + pricing context.
  const cta = useMemo<ReserveCta>(() => {
    if (!hasDates) {
      const missing: MissingTripField[] = [];
      if (!checkIn) missing.push("checkIn");
      // Also "missing" when both are set but the stay is zero/negative nights
      // (e.g. stale URL params) — the checkout is the one to fix.
      if (!checkOut || checkIn) missing.push("checkOut");
      return { kind: "incomplete", label: "Reserve", shortLabel: "Reserve", missing };
    }
    if (datesUnavailable) {
      return { kind: "unavailable", label: "Choose other dates", shortLabel: "New dates" };
    }
    if (!isAuthenticated) {
      return { kind: "login", label: "Log in to reserve", shortLabel: "Log in", href: loginHref };
    }
    return {
      kind: "ready",
      label: "Reserve on WhatsApp",
      shortLabel: "Reserve",
      whatsappNumber,
      details: {
        propertyName,
        propertyId,
        refCode,
        guestName,
        guestPhone,
        checkIn,
        checkOut,
        checkInTime,
        checkOutTime,
        nights,
        guests,
        infants,
        totalMinorUnits: total,
      },
      // What this card is currently quoting, so Reserve can compare it against
      // the database before anything reaches WhatsApp.
      quote: {
        basePrice: listPrice,
        discountedPrice,
        monthlyPrice: monthlyPrice ?? null,
        platformFeePercent,
        total,
      },
    };
  }, [
    hasDates,
    datesUnavailable,
    isAuthenticated,
    loginHref,
    whatsappNumber,
    propertyName,
    propertyId,
    refCode,
    guestName,
    guestPhone,
    checkIn,
    checkOut,
    checkInTime,
    checkOutTime,
    nights,
    guests,
    infants,
    total,
    basePrice,
    listPrice,
    discountedPrice,
    monthlyPrice,
    platformFeePercent,
  ]);

  useEffect(() => {
    setReserveCta(cta);
    return () => setReserveCta(null);
  }, [cta, setReserveCta]);

  // Picking dates is only half the job — the guest still has to check the
  // total and the guest count, which sit below the calendar trigger and on a
  // small phone fall under the floating booking tab. So when the picker closes
  // on a stay that was actually chosen in it, bring that block into view.
  useEffect(() => {
    if (pickerOpen) {
      rangeAtOpen.current = rangeKey;
      return;
    }
    const rangeBefore = rangeAtOpen.current;
    rangeAtOpen.current = null;
    if (!shouldRevealSummary({ rangeBefore, rangeAfter: rangeKey, isCompactLayout })) {
      return;
    }

    // One frame, so the picker's body-scroll lock is released and the newly
    // rendered breakdown is measurable before we aim at it.
    const frame = requestAnimationFrame(() => {
      const target = summaryRef.current;
      if (!target) return;
      const onScreen = isSufficientlyVisible(
        target.getBoundingClientRect(),
        window.innerHeight,
        {
          top: NAVBAR_INSET,
          bottom: BOOKING_TAB_INSET,
          threshold: SUMMARY_VISIBLE_THRESHOLD,
        }
      );
      if (onScreen) return;
      target.scrollIntoView({
        behavior: scrollBehavior(true),
        block: "center",
      });
    });
    return () => cancelAnimationFrame(frame);
    // `rangeKey` is read, never tracked: it has to stay as it was when the
    // picker opened so the close can tell a new stay from an unchanged one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen, isCompactLayout]);

  return (
    <Card className="sticky top-24">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-baseline gap-1">
          {strike ? (
            <span className="text-base text-muted-foreground line-through">
              {formatINR(strike)}
            </span>
          ) : null}
          <span
            className={cn(
              "text-xl font-semibold",
              strike && "discount-price text-rose-600"
            )}
          >
            {formatINR(basePrice)}
          </span>
          <span className="text-muted-foreground">/ night</span>
          {strike ? (
            <span className="discount-badge ml-1 inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-md shadow-rose-600/30">
              {Math.round(((strike - basePrice) / strike) * 100)}% off
            </span>
          ) : null}
        </div>
        {monthlyPrice ? (
          <p className="-mt-2 text-xs text-muted-foreground">
            or {formatINR(monthlyPrice)}/month for stays of 30+ nights
          </p>
        ) : null}

        <DateRangePicker
          checkIn={checkIn}
          checkOut={checkOut}
          onChange={setRange}
          variant="card"
          align="right"
          blockedRanges={blockedRanges}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
        />

        <div ref={summaryRef} className="space-y-4">
          <div className="space-y-3 rounded-xl border px-4 py-3">
            <GuestStepper
              label="Adults"
              value={guests}
              min={1}
              max={maxGuests}
              onChange={(n) => setGuests(Math.max(1, Math.min(maxGuests, n)))}
            />
            {maxInfants > 0 && (
              <>
                <div className="border-t" />
                <GuestStepper
                  label="Infants"
                  value={infants}
                  min={0}
                  max={maxInfants}
                  onChange={(n) => setInfants(Math.max(0, Math.min(maxInfants, n)))}
                />
              </>
            )}
          </div>

          {hasDates && (
            <PricingBreakdown
              basePrice={basePrice}
              listPrice={strike}
              monthlyPrice={monthlyPrice}
              platformFeePercent={platformFeePercent}
              nights={nights}
            />
          )}
        </div>

        {datesUnavailable && (
          <div className="rounded-lg bg-amber-50 p-3 text-center text-sm text-amber-800">
            These dates aren&apos;t available — booked dates are greyed out in the
            calendar.
          </div>
        )}

        {/* On compact screens the floating booking tab renders this same button,
            so the card hides its copy to keep exactly one Reserve on screen. */}
        {!isCompactLayout && <ReserveButton cta={cta} className="w-full" />}

        <p className="text-center text-xs text-muted-foreground">
          {hasDates && !datesUnavailable
            ? "You won't be charged here — reserving opens WhatsApp to confirm with the platform."
            : "Inquiries are handled by the platform on WhatsApp. You won't be charged here."}
        </p>
      </CardContent>
    </Card>
  );
}

// −/value/+ row used for the Adults / Infants selectors in the booking card.
function GuestStepper({
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
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Fewer ${label.toLowerCase()}`}
          onClick={() => onChange(value - 1)}
          disabled={value <= min}
          className="grid h-8 w-8 place-items-center rounded-full border text-lg disabled:opacity-40"
        >
          −
        </button>
        <span className="w-4 text-center text-sm tabular-nums">{value}</span>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          onClick={() => onChange(value + 1)}
          disabled={value >= max}
          className="grid h-8 w-8 place-items-center rounded-full border text-lg disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}
