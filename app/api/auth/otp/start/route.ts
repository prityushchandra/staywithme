import { NextResponse } from "next/server";
import { normalizePhone, startOtp } from "@/lib/otp";
import { phoneStartSchema } from "@/lib/validation";

// Step 1 of phone auth: generate + send a one-time code to the number.
export async function POST(req: Request) {
  const parsed = phoneStartSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid number" },
      { status: 400 }
    );
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json({ error: "That doesn't look like a valid mobile number." }, { status: 400 });
  }

  const result = await startOtp(phone);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 429 });
  }

  // WhatsApp is configured but the send failed (bad template, number not on the
  // allowed test list, expired token, …). Surface it instead of leaving the user
  // waiting for a message that never arrives. (`devCode` is only set in the
  // unconfigured dev fallback, so its absence here means a real send was tried.)
  if (!result.delivered && result.devCode === undefined) {
    return NextResponse.json(
      { error: "We couldn't send your coupon code over WhatsApp just now. Please try again in a moment." },
      { status: 502 }
    );
  }

  // devCode is only present when WhatsApp isn't configured (so the UI can show
  // the code for testing). In production with WhatsApp set up, it's omitted.
  return NextResponse.json({ phone, delivered: result.delivered, devCode: result.devCode });
}
