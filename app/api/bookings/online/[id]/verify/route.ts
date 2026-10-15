import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { confirmBookingPayment, reconcileBookingPayment } from "@/lib/online-bookings";

export const dynamic = "force-dynamic";
// Signature check, gateway lookup, block creation and the admin ping all happen
// here; give it room so a slow Razorpay call can't strand a paid guest.
export const maxDuration = 60;

const schema = z.object({
  razorpay_order_id: z.string().min(1).max(100),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

/**
 * POST /api/bookings/online/[id]/verify
 *
 * With a body: verify the checkout signature, hold the dates and alert the
 * admin. With an empty body: fall back to asking Razorpay whether the order was
 * actually captured — the rescue path for a browser that died mid-payment.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));

  try {
    if (!parsed.success) {
      const recon = await reconcileBookingPayment(id, session.user.id);
      if (!recon.ok) return NextResponse.json({ error: recon.error }, { status: 400 });
      return NextResponse.json({ ok: recon.paid, paid: recon.paid });
    }
    const result = await confirmBookingPayment(id, session.user.id, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, paid: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not confirm the payment.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
