import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { toUtcDate } from "@/lib/dates";
import { startOnlineBooking } from "@/lib/online-bookings";
import { razorpayConfigured } from "@/lib/razorpay";

// Dates and availability must be read live, never from the ISR cache.
export const dynamic = "force-dynamic";

const schema = z.object({
  listingId: z.string().min(1).max(60),
  checkIn: z.string().min(8).max(40),
  checkOut: z.string().min(8).max(40),
  guests: z.coerce.number().int().min(1).max(50),
  contactPhone: z.string().trim().max(20).optional(),
});

/**
 * POST /api/bookings/online — open a draft booking.
 *
 * Nothing is held and nothing is charged here; the draft only exists to give
 * the guest's ID uploads somewhere to live while they finish the form.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in to book." }, { status: 401 });
  }
  if (!razorpayConfigured()) {
    return NextResponse.json(
      { error: "Online payments aren't switched on yet — please book over WhatsApp." },
      { status: 503 }
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const checkIn = toUtcDate(parsed.data.checkIn);
  const checkOut = toUtcDate(parsed.data.checkOut);
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    return NextResponse.json({ error: "Invalid dates." }, { status: 400 });
  }

  const result = await startOnlineBooking({
    listingId: parsed.data.listingId,
    guestId: session.user.id,
    checkIn,
    checkOut,
    guests: parsed.data.guests,
    contactPhone: parsed.data.contactPhone || null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({
    bookingId: result.bookingId,
    total: result.total,
    nights: result.nights,
    docs: result.docs,
  });
}
