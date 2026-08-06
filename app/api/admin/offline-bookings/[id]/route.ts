import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

const patchSchema = z.object({
  amountPaid: z.coerce.number().min(0).optional(),
  status: z.enum(["CONFIRMED", "CANCELLED"]).optional(),
});

function toPaise(rupees: number) {
  return Math.round(rupees * 100);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid update" }, { status: 400 });
  }

  const booking = await prisma.offlineBooking.findUnique({ where: { id } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const data: { amountPaid?: number; due?: number; status?: string; blockId?: null } = {};
  if (parsed.data.amountPaid !== undefined) {
    data.amountPaid = toPaise(parsed.data.amountPaid);
    data.due = Math.max(0, booking.totalPrice - data.amountPaid);
  }

  if (parsed.data.status) {
    data.status = parsed.data.status;
    if (parsed.data.status === "CANCELLED") {
      if (booking.blockId) {
        await prisma.availabilityBlock.deleteMany({ where: { id: booking.blockId } });
      }
      data.blockId = null;
    }
  }

  const updated = await prisma.offlineBooking.update({ where: { id }, data });
  revalidateTag("listings");
  return NextResponse.json({ booking: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const booking = await prisma.offlineBooking.findUnique({ where: { id } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.receipt.deleteMany({ where: { offlineBookingId: id } }),
    prisma.offlineBooking.delete({ where: { id } }),
    ...(booking.blockId ? [prisma.availabilityBlock.deleteMany({ where: { id: booking.blockId } })] : []),
  ]);

  revalidateTag("listings");
  return NextResponse.json({ ok: true });
}
