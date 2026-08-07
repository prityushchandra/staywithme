import { NextResponse, after } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addBlock, toUtcDate } from "@/lib/availability";
import { nextReceiptNumber } from "@/lib/receipts";
import { syncOfflineBooking, syncReceipt } from "@/lib/google-sheets";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

const bookingSchema = z.object({
  listingId: z.string().trim().min(1),
  guestName: z.string().trim().min(1).max(120),
  guestPhone: z.string().trim().max(40).optional(),
  guests: z.coerce.number().int().min(1).max(50),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalPrice: z.coerce.number().min(0),
  amountPaid: z.coerce.number().min(0).default(0),
  source: z.enum(["OFFLINE", "AIRBNB"]).default("OFFLINE"),
  note: z.string().trim().max(500).optional(),
  // Admin chose to book on top of already-blocked dates.
  override: z.boolean().default(false),
});

function toPaise(rupees: number) {
  return Math.round(rupees * 100);
}

function flatLabel(listing: { title: string; flatNumber: string | null; block: string | null }) {
  return listing.flatNumber ? `${listing.flatNumber}${listing.block ? `, ${listing.block}` : ""}` : listing.title;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const bookings = await prisma.offlineBooking.findMany({
    include: { listing: { select: { title: true, flatNumber: true, block: true } }, receipts: { select: { number: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ bookings });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const session = await auth();
  const parsed = bookingSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid booking details" },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const checkIn = toUtcDate(input.checkIn);
  const checkOut = toUtcDate(input.checkOut);
  if (checkOut.getTime() <= checkIn.getTime()) {
    return NextResponse.json({ error: "Check-out must be after check-in." }, { status: 400 });
  }

  const listing = await prisma.listing.findUnique({
    where: { id: input.listingId },
    select: {
      id: true,
      title: true,
      flatNumber: true,
      block: true,
      checkInTime: true,
      checkOutTime: true,
    },
  });
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  const totalPrice = toPaise(input.totalPrice);
  const amountPaid = toPaise(input.amountPaid);
  const due = Math.max(0, totalPrice - amountPaid);

  const blockResult = await addBlock({
    listingId: input.listingId,
    startDate: checkIn,
    endDate: checkOut,
    kind: "BOOKING",
    guestName: input.guestName,
    guests: input.guests,
    note: input.note,
    createdById: session?.user?.id ?? null,
    allowOverlap: input.override,
  });
  if (!blockResult.ok) {
    // Dates overlap existing blocks. Report the conflicts so the client can
    // offer an "override & book anyway" option (re-POST with override: true).
    return NextResponse.json(
      {
        error: blockResult.error,
        conflict: true,
        conflicts: (blockResult.conflicts ?? []).map((b) => ({
          startDate: b.startDate.toISOString(),
          endDate: b.endDate.toISOString(),
          kind: b.kind,
          guestName: b.guestName,
        })),
      },
      { status: 409 }
    );
  }

  try {
    const receiptNumber = await nextReceiptNumber();
    const booking = await prisma.$transaction(async (tx) => {
      const created = await tx.offlineBooking.create({
        data: {
          listingId: input.listingId,
          guestName: input.guestName,
          guestPhone: input.guestPhone || null,
          guests: input.guests,
          checkIn,
          checkOut,
          totalPrice,
          amountPaid,
          due,
          source: input.source,
          status: "CONFIRMED",
          note: input.note || null,
          blockId: blockResult.block.id,
          publicToken: crypto.randomUUID().replace(/-/g, ""),
          createdById: session?.user?.id ?? null,
        },
      });

      await tx.receipt.create({
        data: {
          number: receiptNumber,
          type: "BOOKING",
          offlineBookingId: created.id,
          refId: created.id,
          data: {
            guestName: input.guestName,
            guestPhone: input.guestPhone || null,
            listingTitle: listing.title,
            flat: flatLabel(listing),
            checkIn: checkIn.toISOString(),
            checkOut: checkOut.toISOString(),
            checkInTime: listing.checkInTime,
            checkOutTime: listing.checkOutTime,
            guests: input.guests,
            totalPrice,
            amountPaid,
            due,
            source: input.source,
          },
        },
      });

      return created;
    });

    after(async () => {
      await Promise.allSettled([
        syncOfflineBooking({
          receiptNumber,
          listingTitle: listing.title,
          flat: flatLabel(listing),
          guestName: booking.guestName,
          guestPhone: booking.guestPhone,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          guests: booking.guests,
          totalPrice: booking.totalPrice,
          amountPaid: booking.amountPaid,
          due: booking.due,
          source: booking.source,
          status: booking.status,
          createdAt: booking.createdAt,
        }),
        syncReceipt({ number: receiptNumber, type: "BOOKING", who: booking.guestName, amount: booking.totalPrice, createdAt: booking.createdAt }),
      ]);
    });

    revalidateTag("listings");
    return NextResponse.json({ id: booking.id, receiptNumber, receiptUrl: `/api/receipts/booking/${booking.id}` }, { status: 201 });
  } catch (e) {
    await prisma.availabilityBlock.delete({ where: { id: blockResult.block.id } }).catch(() => {});
    return NextResponse.json({ error: "Could not record booking" }, { status: 500 });
  }
}
