import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
const schema = z.object({ active: z.boolean() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid coupon update." }, { status: 400 });
  const { id } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ListingCoupon" WHERE "id" = ${id} FOR UPDATE`;
      const coupon = await tx.listingCoupon.findUnique({
        where: { id }, select: { reservation: { select: { couponId: true } } },
      });
      if (!coupon) return { error: "Coupon not found.", status: 404 };
      if (coupon.reservation) return { error: "Reserved or used coupons cannot be changed.", status: 409 };
      await tx.listingCoupon.update({ where: { id }, data: { active: parsed.data.active } });
      return { status: 200 };
    });
    return NextResponse.json(result.error ? { error: result.error } : { ok: true }, { status: result.status });
  } catch (error) {
    console.error("Updating listing coupon failed", { couponId: id, error });
    return NextResponse.json({ error: "Could not update the coupon. Please retry." }, { status: 500 });
  }
}
