import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseGuestDocument } from "@/lib/booking-documents";
import { OFFLINE_GUEST_SELECT, OfflineGuestDetailsError } from "@/lib/offline-booking-guests";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const positionValue = form?.get("position");
  const nameValue = form?.get("name");
  const position = typeof positionValue === "string" && /^\d{1,2}$/.test(positionValue)
    ? Number(positionValue) : -1;
  const name = typeof nameValue === "string" ? nameValue.trim() : "";
  if (position < 0 || position >= 50 || !name || name.length > 120) {
    return NextResponse.json({ error: "Choose a valid guest and enter their full name." }, { status: 400 });
  }
  const parsed = await parseGuestDocument(form?.get("file") ?? null);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const doc = await prisma.$transaction(async (tx) => {
      const booking = await tx.offlineBooking.update({
        where: { id },
        data: { updatedAt: new Date() },
        select: { guests: true, guestName: true },
      });
      if (position >= booking.guests) {
        throw new OfflineGuestDetailsError("This guest is outside the booking's guest count.");
      }
      const guestName = position === 0 ? booking.guestName : name;
      return tx.offlineBookingGuest.upsert({
        where: { bookingId_position: { bookingId: id, position } },
        create: { bookingId: id, position, name: guestName, ...parsed.data },
        update: { name: guestName, ...parsed.data },
        select: OFFLINE_GUEST_SELECT,
      });
    });
    revalidatePath("/admin/bookings");
    return NextResponse.json({ doc });
  } catch (error) {
    if (error instanceof OfflineGuestDetailsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    console.error("[offline-bookings] guest ID upload failed", {
      code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "UNKNOWN",
    });
    return NextResponse.json({ error: "Could not upload the guest's ID. Please retry." }, { status: 500 });
  }
}
