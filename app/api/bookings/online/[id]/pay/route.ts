import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createBookingOrder } from "@/lib/online-bookings";
import { razorpayConfigured, razorpayPublicKey } from "@/lib/razorpay";

export const dynamic = "force-dynamic";

const schema = z.object({
  reasonForVisit: z.string().trim().min(3).max(500),
  contactPhone: z.string().trim().min(6).max(20),
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
    where: { id, guestId: session.user.id, status: "PENDING" },
    data: {
      reasonForVisit: parsed.data.reasonForVisit,
      contactPhone: parsed.data.contactPhone,
    },
  });
  if (!count) return NextResponse.json({ error: "Booking not found." }, { status: 404 });

  try {
    const result = await createBookingOrder(id, session.user.id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({
      keyId,
      razorpayOrderId: result.razorpayOrderId,
      amount: result.amount,
      currency: "INR",
      description: result.description,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start the payment.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
