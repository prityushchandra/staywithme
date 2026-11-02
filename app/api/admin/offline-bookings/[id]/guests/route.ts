import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DOCUMENT_METADATA_SELECT, parseGuestUpload } from "@/lib/booking-documents";
import { OfflineGuestDetailsError } from "@/lib/offline-booking-guests";

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
  const parsed = await parseGuestUpload(form);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { position, name, uploadId } = parsed;

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
      const guest = await tx.offlineBookingGuest.upsert({
        where: { bookingId_position: { bookingId: id, position } },
        create: { bookingId: id, position, name: guestName },
        update: { name: guestName },
        select: { id: true },
      });
      const document = await tx.offlineBookingGuestDocument.upsert({
        where: { guestId_uploadId: { guestId: guest.id, uploadId } },
        create: { guestId: guest.id, uploadId, ...parsed.data },
        update: {},
        select: DOCUMENT_METADATA_SELECT,
      });
      return { ...document, position, name: guestName };
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
