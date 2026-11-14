import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { couponCodeSchema } from "@/lib/coupons";
import { MONTHLY_MIN_NIGHTS } from "@/lib/pricing";

export const dynamic = "force-dynamic";
const schema = z.object({
  listingId: z.string().min(1).max(60),
  code: couponCodeSchema.optional(),
  kind: z.enum(["DAILY", "MONTHLY"]),
  amount: z.number().int().min(100, "The coupon price must be at least INR 1.").max(2_147_483_647),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid coupon." }, { status: 400 });
  }
  try {
    const listing = await prisma.listing.findUnique({
      where: { id: parsed.data.listingId }, select: { status: true, basePrice: true },
    });
    if (!listing || listing.status !== "PUBLISHED") {
      return NextResponse.json({ error: "Choose a published listing." }, { status: 400 });
    }
    const regular = listing.basePrice * (parsed.data.kind === "MONTHLY" ? MONTHLY_MIN_NIGHTS : 1);
    if (parsed.data.amount >= regular) {
      return NextResponse.json({ error: "The coupon price must be lower than this listing's regular price." }, { status: 400 });
    }
    const coupon = await prisma.listingCoupon.create({
      data: { ...parsed.data, code: parsed.data.code ?? `SWM-${randomBytes(4).toString("hex").toUpperCase()}` },
      select: { id: true, code: true },
    });
    return NextResponse.json({ ok: true, ...coupon }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "That coupon code already exists. Choose another code." }, { status: 409 });
    }
    console.error("Creating listing coupon failed", { error });
    return NextResponse.json({ error: "Could not create the coupon. Please retry." }, { status: 500 });
  }
}
