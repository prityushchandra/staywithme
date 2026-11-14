import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { reconcileBookingPayment } from "@/lib/online-bookings";
import { verifyRazorpayWebhookSignature } from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const eventSchema = z.object({ event: z.string() });
const paymentEventSchema = z.object({
  payload: z.object({
    payment: z.object({
      entity: z.object({ id: z.string().min(1), order_id: z.string().min(1).nullable() }),
    }),
  }),
});

export async function POST(req: Request) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.error("Razorpay webhook secret is not configured");
    return NextResponse.json({ error: "Webhook unavailable" }, { status: 503 });
  }
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody) > 256_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  if (!verifyRazorpayWebhookSignature(rawBody, req.headers.get("x-razorpay-signature") ?? "")) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const event = eventSchema.safeParse(body);
  if (!event.success) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  if (event.data.event !== "payment.captured" && event.data.event !== "order.paid") {
    return NextResponse.json({ received: true, ignored: true });
  }
  const parsed = paymentEventSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payment event" }, { status: 400 });
  const orderId = parsed.data.payload.payment.entity.order_id;
  if (!orderId) return NextResponse.json({ received: true, ignored: true });

  try {
    const booking = await prisma.booking.findUnique({
      where: { razorpayOrderId: orderId },
      select: { id: true, guestId: true, source: true, status: true, razorpayPaymentId: true },
    });
    if (!booking || booking.source !== "ONLINE") {
      return NextResponse.json({ received: true, ignored: true });
    }
    if (booking.status === "CANCELLED" && booking.razorpayPaymentId === parsed.data.payload.payment.entity.id) {
      return NextResponse.json({ received: true });
    }
    // Re-fetch from Razorpay so a delayed event cannot restore a refunded payment.
    const result = await reconcileBookingPayment(booking.id, booking.guestId);
    if (!result.ok || !result.paid) {
      console.error("Razorpay webhook payment needs attention", {
        bookingId: booking.id, reason: result.ok ? "Capture not available yet" : result.error,
      });
      return NextResponse.json({ error: "Payment could not be reconciled" }, { status: 503 });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Razorpay webhook reconciliation failed", { error });
    return NextResponse.json({ error: "Payment reconciliation temporarily unavailable" }, { status: 503 });
  }
}
