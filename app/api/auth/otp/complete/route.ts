import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePhone, hasVerifiedOtp } from "@/lib/otp";
import { signupCompleteSchema } from "@/lib/validation";

// Sign-up completion: only reachable after the phone's code was verified. Names
// were collected on the sign-up screen; this creates the account. The actual
// session is then issued by the "phone" credentials provider (which consumes
// the verified code).
export async function POST(req: Request) {
  const parsed = signupCompleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json({ error: "Invalid number" }, { status: 400 });
  }

  // Guard: the code for this number must have been verified recently.
  if (!(await hasVerifiedOtp(phone))) {
    return NextResponse.json({ error: "Please verify your number first." }, { status: 401 });
  }

  const firstName = parsed.data.firstName.trim();
  const lastName = parsed.data.lastName.trim();

  // Idempotent: if the account already exists, just keep its names current.
  const existing = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (existing) {
    await prisma.user.update({
      where: { phone },
      data: { firstName, lastName, name: `${firstName} ${lastName}` },
    });
    return NextResponse.json({ ok: true });
  }

  await prisma.user.create({
    data: {
      phone,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      roles: ["GUEST"],
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
