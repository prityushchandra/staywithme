import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rangesOverlap, toUtcDate } from "@/lib/dates";
import { clearMemo } from "@/lib/memo";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

const patchSchema = z.object({
  guestName: z.string().trim().min(1).max(120).optional(),
  guestPhone: z.string().trim().max(40).nullable().optional(),
  guests: z.coerce.number().int().min(1).max(50).optional(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  totalPrice: z.coerce.number().min(0).optional(),
  amountPaid: z.coerce.number().min(0).optional(),
  source: z.enum(["OFFLINE", "AIRBNB"]).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  status: z.enum(["CONFIRMED", "CANCELLED"]).optional(),
  // Book on top of already-blocked dates when moving the stay.
  override: z.boolean().optional(),
});

function toPaise(rupees: number) {
  return Math.round(rupees * 100);
}

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  return l.flatNumber ? `${l.flatNumber}${l.block ? `, ${l.block}` : ""}` : l.title;
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
  const input = parsed.data;

  const booking = await prisma.offlineBooking.findUnique({
    where: { id },
    include: {
      listing: { select: { title: true, flatNumber: true, block: true, checkInTime: true, checkOutTime: true } },
      receipts: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const data: Record<string, unknown> = {};

  // --- Simple field edits ---
  if (input.guestName !== undefined) data.guestName = input.guestName;
  if (input.guestPhone !== undefined) data.guestPhone = input.guestPhone || null;
  if (input.guests !== undefined) data.guests = input.guests;
  if (input.source !== undefined) data.source = input.source;
  if (input.note !== undefined) data.note = input.note || null;

  // --- Money (recompute due from the resulting total & paid) ---
  const totalPrice = input.totalPrice !== undefined ? toPaise(input.totalPrice) : booking.totalPrice;
  const amountPaid = input.amountPaid !== undefined ? toPaise(input.amountPaid) : booking.amountPaid;
  if (input.totalPrice !== undefined) data.totalPrice = totalPrice;
  if (input.amountPaid !== undefined) data.amountPaid = amountPaid;
  if (input.totalPrice !== undefined || input.amountPaid !== undefined) {
    data.due = Math.max(0, totalPrice - amountPaid);
  }

  // --- Dates (keep the availability block in sync) ---
  let newCheckIn = booking.checkIn;
  let newCheckOut = booking.checkOut;
  const datesChanged = input.checkIn !== undefined || input.checkOut !== undefined;
  if (datesChanged) {
    newCheckIn = input.checkIn ? toUtcDate(input.checkIn) : booking.checkIn;
    newCheckOut = input.checkOut ? toUtcDate(input.checkOut) : booking.checkOut;
    if (newCheckOut.getTime() <= newCheckIn.getTime()) {
      return NextResponse.json({ error: "Check-out must be after check-in." }, { status: 400 });
    }

    // Overlap check against OTHER blocks (exclude this booking's own block).
    const others = await prisma.availabilityBlock.findMany({
      where: { listingId: booking.listingId, ...(booking.blockId ? { id: { not: booking.blockId } } : {}) },
      select: { id: true, startDate: true, endDate: true, kind: true, guestName: true },
    });
    const conflicts = others.filter((b) => rangesOverlap(newCheckIn, newCheckOut, b.startDate, b.endDate));
    if (conflicts.length && !input.override) {
      return NextResponse.json(
        {
          error: "These dates overlap an existing block.",
          conflict: true,
          conflicts: conflicts.map((b) => ({
            startDate: b.startDate.toISOString(),
            endDate: b.endDate.toISOString(),
            kind: b.kind,
            guestName: b.guestName,
          })),
        },
        { status: 409 }
      );
    }

    data.checkIn = newCheckIn;
    data.checkOut = newCheckOut;
  }

  // --- Status (cancel frees the dates) ---
  if (input.status) {
    data.status = input.status;
    if (input.status === "CANCELLED") {
      if (booking.blockId) await prisma.availabilityBlock.deleteMany({ where: { id: booking.blockId } });
      data.blockId = null;
    }
  }

  const willBeConfirmed = (input.status ?? booking.status) !== "CANCELLED";
  const guestNameFinal = (input.guestName ?? booking.guestName) as string;
  const guestsFinal = (input.guests ?? booking.guests) as number;

  await prisma.$transaction(async (tx) => {
    await tx.offlineBooking.update({ where: { id }, data });

    // Keep the block's dates/guest in sync (only while the booking is active and
    // wasn't just cancelled above).
    if ((datesChanged || input.guestName !== undefined || input.guests !== undefined) && willBeConfirmed && data.blockId !== null) {
      if (booking.blockId) {
        await tx.availabilityBlock.update({
          where: { id: booking.blockId },
          data: { startDate: newCheckIn, endDate: newCheckOut, guestName: guestNameFinal, guests: guestsFinal },
        });
      } else if (datesChanged) {
        const block = await tx.availabilityBlock.create({
          data: { listingId: booking.listingId, startDate: newCheckIn, endDate: newCheckOut, kind: "BOOKING", guestName: guestNameFinal, guests: guestsFinal },
        });
        await tx.offlineBooking.update({ where: { id }, data: { blockId: block.id } });
      }
    }

    // Refresh the receipt snapshot so mirrored data stays consistent (the PDF is
    // generated live from the booking, so it already reflects the edit).
    const receiptId = booking.receipts[0]?.id;
    if (receiptId) {
      await tx.receipt.update({
        where: { id: receiptId },
        data: {
          data: {
            guestName: guestNameFinal,
            guestPhone: (input.guestPhone !== undefined ? input.guestPhone : booking.guestPhone) || null,
            listingTitle: booking.listing.title,
            flat: flatLabel(booking.listing),
            checkIn: newCheckIn.toISOString(),
            checkOut: newCheckOut.toISOString(),
            checkInTime: booking.listing.checkInTime,
            checkOutTime: booking.listing.checkOutTime,
            guests: guestsFinal,
            totalPrice,
            amountPaid,
            due: Math.max(0, totalPrice - amountPaid),
            source: input.source ?? booking.source,
          },
        },
      });
    }
  });

  revalidateTag("listings");
  clearMemo();
  const updated = await prisma.offlineBooking.findUnique({ where: { id } });
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
