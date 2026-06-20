import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePhone, verifyOtp } from "@/lib/otp";
import { otpVerifySchema } from "@/lib/validation";

// Step 2 of phone auth: check the code. On success, tell the client whether an
// account already exists (-> sign in) or not (-> collect name on sign-up).
export async function POST(req: Request) {
  const parsed = otpVerifySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid code" },
      { status: 400 }
    );
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json({ error: "Invalid number" }, { status: 400 });
  }

  const result = await verifyOtp(phone, parsed.data.code);
  if (result !== "ok") {
    const messages: Record<"invalid" | "expired" | "too_many", string> = {
      invalid: "That code isn't right. Try again.",
      expired: "That code has expired. Request a new one.",
      too_many: "Too many attempts. Request a new code.",
    };
    return NextResponse.json({ error: messages[result] }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  return NextResponse.json({ status: existing ? "existing" : "new", phone });
}
