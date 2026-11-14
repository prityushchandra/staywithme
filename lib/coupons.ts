import { z } from "zod";
import type { CouponReservation, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { computeStayPricing, meetsMinimumStay, minimumStayMessage, MONTHLY_MIN_NIGHTS, type StayPricing } from "./pricing";

export const couponCodeSchema = z.string().trim().toUpperCase().min(4).max(32)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Use 4-32 letters, numbers or hyphens for the coupon code.");

export function reservedCouponPricing(reservation: CouponReservation): StayPricing {
  const total = reservation.baseAmount + reservation.platformFee;
  const savings = Math.max(0, reservation.regularTotal - total);
  return {
    base: reservation.baseAmount,
    platformFee: reservation.platformFee,
    platformFeePercent: reservation.platformFeePercent,
    total,
    totalBeforeDiscount: total,
    monthlyStayDiscount: 0,
    regularBase: reservation.regularBase,
    regularTotal: reservation.regularTotal,
    savings,
    savingsPercent: savings > 0 ? Math.floor(savings / reservation.regularTotal * 100) : 0,
    monthly: reservation.kind === "MONTHLY",
    coupon: { code: reservation.code, kind: reservation.kind, amount: reservation.amount },
  };
}

export async function availableCoupon(
  listingId: string,
  code: string,
  nights: number,
  db: Pick<Prisma.TransactionClient, "listingCoupon"> = prisma
) {
  const parsed = couponCodeSchema.safeParse(code);
  if (!parsed.success) return { ok: false as const, error: "Enter a valid coupon code." };
  const coupon = await db.listingCoupon.findUnique({
    where: { code: parsed.data },
    include: { reservation: { select: { couponId: true } } },
  });
  if (!coupon || coupon.listingId !== listingId || !coupon.active) {
    return { ok: false as const, error: "This coupon is not available for this listing." };
  }
  if (coupon.reservation) {
    return { ok: false as const, error: "This coupon has already been reserved for a booking." };
  }
  if (coupon.kind === "MONTHLY" && nights < MONTHLY_MIN_NIGHTS) {
    return { ok: false as const, error: "Monthly coupons require at least 30 nights." };
  }
  return { ok: true as const, coupon };
}

export async function reserveBookingCoupon(input: {
  bookingId: string;
  guestId: string;
  guests: number;
  code: string;
  expectedTotal: number;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${input.bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      include: { listing: true, couponReservation: true },
    });
    if (!booking || booking.guestId !== input.guestId || booking.source !== "ONLINE" ||
        booking.status !== "PENDING" || booking.guests !== input.guests) {
      return { ok: false as const, error: "The booking changed. Please reopen it before paying." };
    }
    if (booking.couponReservation) {
      const pricing = reservedCouponPricing(booking.couponReservation);
      if (booking.couponReservation.code !== input.code || pricing.total !== input.expectedTotal) {
        return { ok: false as const, error: "This booking already has a locked coupon price. Please review it before paying.",
          pricing, pricingLocked: true };
      }
      return { ok: true as const, pricing };
    }
    if (booking.razorpayOrderId) {
      return { ok: false as const, error: "Checkout already started without a coupon. Please retry the original payment." };
    }

    // Lock the coupon row too: competing bookings and an admin pause cannot
    // both win after seeing an unused code.
    await tx.$queryRaw`SELECT "id" FROM "ListingCoupon" WHERE "code" = ${input.code} FOR UPDATE`;
    const nights = Math.round((booking.checkOut.getTime() - booking.checkIn.getTime()) / 86_400_000);
    const coupon = await availableCoupon(booking.listingId, input.code, nights, tx);
    if (!coupon.ok) return coupon;
    if (booking.listing.status !== "PUBLISHED") {
      return { ok: false as const, error: "Listing not found." };
    }
    if (!meetsMinimumStay(nights, booking.listing.minimumNights)) {
      return { ok: false as const, error: `${minimumStayMessage(booking.listing.minimumNights ?? 1)}. Please choose a longer stay.` };
    }
    const settings = await tx.platformSettings.findUnique({
      where: { id: "singleton" }, select: { platformFeePercent: true },
    });
    const pricing = computeStayPricing(booking.listing, nights, {
      platformFeePercent: settings?.platformFeePercent ?? 10,
    }, { code: coupon.coupon.code, kind: coupon.coupon.kind, amount: coupon.coupon.amount });
    if (pricing.total !== input.expectedTotal) {
      return { ok: false as const, error: "The price changed. Review the updated total and select Pay now again.",
        pricing, pricingLocked: false };
    }
    if (!Number.isSafeInteger(pricing.total) || pricing.total <= 0 || pricing.total > 2_147_483_647) {
      return { ok: false as const, error: "This coupon total cannot be booked online. Please contact us." };
    }
    await tx.couponReservation.create({
      data: {
        couponId: coupon.coupon.id, bookingId: booking.id,
        code: coupon.coupon.code, kind: coupon.coupon.kind, amount: coupon.coupon.amount,
        baseAmount: pricing.base, platformFee: pricing.platformFee,
        platformFeePercent: pricing.platformFeePercent, regularBase: pricing.regularBase, regularTotal: pricing.regularTotal,
      },
    });
    await tx.booking.update({ where: { id: booking.id }, data: { totalAmount: pricing.total } });
    return { ok: true as const, pricing };
  }, { timeout: 15_000 });
}
