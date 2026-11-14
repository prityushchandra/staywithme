import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createBookingOrder } from "@/lib/online-bookings";
import { razorpayConfigured, razorpayPublicKey } from "@/lib/razorpay";
import { couponCodeSchema } from "@/lib/coupons";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  reasonForVisit: z.string().trim().min(3).max(500),
  contactPhone: z.string().trim().min(6).max(20),
  couponCode: couponCodeSchema.nullable().optional(),
  expectedTotal: z.number().int().positive().max(2_147_483_647).optional(),
});

/**
 * POST /api/bookings/online/[id]/pay — create the Razorpay order.
 *
 * Reason for visit and contact number are saved here rather than at draft time
 * so the guest can edit them right up to the moment they pay. Availability and
 * price are re-checked inside createBookingOrder.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const keyId = razorpayPublicKey();
  if (!razorpayConfigured() || !keyId) {
    return NextResponse.json(
      { error: "Online payments aren't switched on yet — please book over WhatsApp." },
      { status: 503 }
    );
  }

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please add a reason for your visit and a contact number." },
      { status: 400 }
    );
  }

  const { count } = await prisma.booking.updateMany({
    where: { id, guestId: session.user.id, status: "PENDING", source: "ONLINE" },
    data: {
      reasonForVisit: parsed.data.reasonForVisit,
      contactPhone: parsed.data.contactPhone,
    },
  });
  if (!count) return NextResponse.json({ error: "Booking not found." }, { status: 404 });

  try {
    const result = await createBookingOrder(id, session.user.id, {
      couponCode: parsed.data.couponCode, expectedTotal: parsed.data.expectedTotal,
    });
    if (!result.ok) return NextResponse.json({
      error: result.error, pricing: result.pricing, pricingLocked: result.pricingLocked,
    }, { status: 400 });
    return NextResponse.json({
      keyId,
      razorpayOrderId: result.razorpayOrderId,
      amount: result.amount,
      currency: "INR",
      description: result.description,
      pricing: result.pricing,
      pricingLocked: result.pricingLocked,
    });
  } catch (err) {
    console.error("Creating booking payment failed", { bookingId: id, error: err });
    return NextResponse.json({ error: "Could not check or start the payment. Please retry shortly." }, { status: 502 });
  }
}
