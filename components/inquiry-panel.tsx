"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/date-range-picker";
import { PricingBreakdown } from "@/components/pricing-breakdown";
import { WhatsAppContactButton } from "@/components/whatsapp-contact-button";
import { useBooking } from "@/components/booking-context";
import { computePricing, computeStayBase, formatINR } from "@/lib/pricing";
import { isRangeAvailable, toUtcDate } from "@/lib/dates";

// Sticky booking card. Dates & guests come from the shared booking context, so
// it stays in sync with the on-page availability calendar. "Reserve" opens the
// date picker when no dates are chosen; once valid dates are set it opens
// WhatsApp with a pre-filled reservation message. No booking, no payment.
export function InquiryPanel({
  propertyId,
  refCode,
  propertyName,
  basePrice,
  monthlyPrice,
  platformFeePercent,
  maxGuests,
  whatsappNumber,
  guestName,
  guestPhone,
  checkInTime,
  checkOutTime,
  blockedRanges = [],
  isAuthenticated = false,
}: {
  propertyId: string;
  refCode?: string;
  propertyName: string;
  basePrice: number;
  monthlyPrice?: number | null;
  platformFeePercent: number;
  maxGuests: number;
  whatsappNumber: string;
  guestName?: string;
  guestPhone?: string;
  checkInTime?: string;
  checkOutTime?: string;
  blockedRanges?: { startDate: string; endDate: string }[];
  isAuthenticated?: boolean;
}) {
  const { checkIn, checkOut, guests, setRange, setGuests } = useBooking();
  const [pickerOpen, setPickerOpen] = useState(false);
  const loginHref = `/sign-in?callbackUrl=${encodeURIComponent(`/listings/${propertyId}`)}`;

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

  return (
    <Card className="sticky top-24">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-semibold">{formatINR(basePrice)}</span>
          <span className="text-muted-foreground">/ night</span>
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

        <div className="space-y-1">
          <Label className="text-xs">Guests</Label>
          <div className="flex items-center justify-between rounded-xl border px-4 py-3">
            <span className="text-sm">
              {guests} guest{guests > 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Fewer guests"
                onClick={() => setGuests(Math.max(1, guests - 1))}
                disabled={guests <= 1}
                className="grid h-8 w-8 place-items-center rounded-full border text-lg disabled:opacity-40"
              >
                −
              </button>
              <span className="w-4 text-center text-sm tabular-nums">{guests}</span>
              <button
                type="button"
                aria-label="More guests"
                onClick={() => setGuests(Math.min(maxGuests, guests + 1))}
                disabled={guests >= maxGuests}
                className="grid h-8 w-8 place-items-center rounded-full border text-lg disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Up to {maxGuests} guests</p>
        </div>

        {hasDates && (
          <PricingBreakdown
            basePrice={basePrice}
            monthlyPrice={monthlyPrice}
            platformFeePercent={platformFeePercent}
            nights={nights}
          />
        )}

        {!hasDates ? (
          <Button
            variant="brand"
            size="lg"
            className="w-full"
            onClick={() => setPickerOpen(true)}
          >
            Reserve
          </Button>
        ) : datesUnavailable ? (
          <div className="space-y-2">
            <div className="rounded-lg bg-amber-50 p-3 text-center text-sm text-amber-800">
              These dates aren&apos;t available — booked dates are greyed out in
              the calendar.
            </div>
            <Button
              variant="brand"
              size="lg"
              className="w-full"
              onClick={() => setPickerOpen(true)}
            >
              Choose other dates
            </Button>
          </div>
        ) : !isAuthenticated ? (
          <Button asChild variant="brand" size="lg" className="w-full">
            <Link href={loginHref}>Log in to reserve</Link>
          </Button>
        ) : (
          <WhatsAppContactButton
            className="w-full"
            variant="brand"
            label="Reserve on WhatsApp"
            whatsappNumber={whatsappNumber}
            details={{
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
              totalMinorUnits: total,
            }}
          />
        )}

        <p className="text-center text-xs text-muted-foreground">
          {hasDates && !datesUnavailable
            ? "You won't be charged here — reserving opens WhatsApp to confirm with the platform."
            : "Inquiries are handled by the platform on WhatsApp. You won't be charged here."}
        </p>
      </CardContent>
    </Card>
  );
}
