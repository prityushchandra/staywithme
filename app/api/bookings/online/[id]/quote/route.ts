import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { couponCodeSchema, reservedCouponPricing } from "@/lib/coupons";
import { quoteStay } from "@/lib/online-bookings";

export const dynamic = "force-dynamic";
const schema = z.object({ couponCode: couponCodeSchema.nullable() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid coupon code." }, { status: 400 });
  const { id } = await params;
  try {
    const booking = await prisma.booking.findUnique({
      where: { id },
      select: {
        guestId: true, source: true, status: true, listingId: true, checkIn: true, checkOut: true,
        razorpayOrderId: true, couponReservation: true,
      },
    });
    if (!booking || booking.guestId !== session.user.id || booking.source !== "ONLINE" || booking.status !== "PENDING") {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }
    if (booking.couponReservation && parsed.data.couponCode !== booking.couponReservation.code) {
      return NextResponse.json({
        error: "This coupon is locked to your booking and cannot be changed.",
        pricing: reservedCouponPricing(booking.couponReservation), pricingLocked: true,
      }, { status: 409 });
    }
    if (booking.razorpayOrderId && !booking.couponReservation && parsed.data.couponCode) {
      return NextResponse.json({ error: "Checkout already started without a coupon. Please retry the original payment." }, { status: 409 });
    }
    const quote = await quoteStay(booking.listingId, booking.checkIn, booking.checkOut, {
      couponCode: parsed.data.couponCode, reservation: booking.couponReservation,
    });
    if (!quote.ok) return NextResponse.json({ error: quote.error }, { status: 400 });
    if (!quote.available) return NextResponse.json({ error: "Those dates have just been taken. Please pick another range." }, { status: 409 });
    return NextResponse.json({
      pricing: quote.pricing, pricingLocked: !!(booking.couponReservation || booking.razorpayOrderId),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quoting booking coupon failed", { bookingId: id, error });
    return NextResponse.json({ error: "Could not check the coupon. Please retry shortly." }, { status: 500 });
  }
}
