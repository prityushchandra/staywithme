import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlatformSettings } from "@/lib/settings";
import { bookingReceiptFileName } from "@/lib/receipts";
import { BookingReceiptPdf } from "@/lib/pdf/booking-receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  return !!session?.user?.isAdmin;
}

function flat(l: { title: string; flatNumber: string | null; block: string | null }) {
  return l.flatNumber ? `${l.flatNumber}${l.block ? `, ${l.block}` : ""}` : l.title;
}
function nights(a: Date, b: Date) {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function pdfResponse(buffer: Buffer, guestName: string, checkIn: Date, download: boolean) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${bookingReceiptFileName(guestName, checkIn)}"`,
      "Cache-Control": "no-store",
    },
  });
}

// Receipt for a paid online booking. Only issued once money has actually
// landed — an unpaid draft has nothing to receipt.
async function onlineReceipt(id: string, token: string | null, download: boolean) {
  const b = await prisma.booking.findUnique({
    where: { id },
    include: {
      listing: {
        select: {
          title: true, flatNumber: true, block: true, city: true,
          checkInTime: true, checkOutTime: true,
          cancellationPolicy: true,
        },
      },
      guest: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!b) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (b.amountPaid <= 0)
    return NextResponse.json({ error: "No payment recorded for this booking" }, { status: 409 });

  const tokenOk = !!token && !!b.publicToken && token === b.publicToken;
  if (!tokenOk) {
    const session = await auth();
    const allowed = !!session?.user?.isAdmin || session?.user?.id === b.guestId;
    if (!allowed) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  const [policy, settings] = await Promise.all([
    prisma.cancellationPolicyText.findUnique({ where: { policy: b.listing.cancellationPolicy } }),
    getPlatformSettings(),
  ]);

  const buffer = await renderToBuffer(
    BookingReceiptPdf({
      number: `SWM-${b.id.slice(-6).toUpperCase()}`,
      createdAt: b.paidAt ?? b.createdAt,
      guestName: b.guest.name ?? "Guest",
      guestPhone: b.contactPhone ?? b.guest.phone,
      flat: flat(b.listing),
      city: b.listing.city,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      checkInTime: b.listing.checkInTime,
      checkOutTime: b.listing.checkOutTime,
      nights: nights(b.checkIn, b.checkOut),
      guests: b.guests,
      totalPrice: b.totalAmount,
      amountPaid: b.amountPaid,
      due: Math.max(0, b.totalAmount - b.amountPaid),
      source: b.status === "CANCELLED" ? "CANCELLED" : "ONLINE",
      policyTitle: policy?.title ?? String(b.listing.cancellationPolicy),
      policyDescription:
        policy?.description ?? "Please contact StayWithMe for cancellation details.",
      whatsappNumber: settings.whatsappNumber,
    }),
  );

  return pdfResponse(buffer, b.guest.name ?? "Guest", b.checkIn, download);
}

// Booking receipt as a PDF (flows to any length — never cropped).
// Serves BOTH offline bookings and online (Razorpay) bookings — their ids live
// in different tables but never collide, so one id resolves to exactly one row.
// Access: admin session, the guest who owns the booking, OR a link carrying the
// booking's unguessable ?t=<publicToken>.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const url = new URL(req.url);
  const download = url.searchParams.has("download");
  const token = url.searchParams.get("t");
  const { id } = await params;

  const booking = await prisma.offlineBooking.findUnique({
    where: { id },
    include: {
      listing: {
        select: {
          title: true, flatNumber: true, block: true, city: true,
          checkInTime: true, checkOutTime: true,
          cancellationPolicy: true,
        },
      },
      receipts: { select: { number: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!booking) return onlineReceipt(id, token, download);

  const tokenOk = !!token && !!booking.publicToken && token === booking.publicToken;
  if (!tokenOk && !(await requireAdmin()))
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const [policy, settings] = await Promise.all([
    prisma.cancellationPolicyText.findUnique({ where: { policy: booking.listing.cancellationPolicy } }),
    getPlatformSettings(),
  ]);
  const receipt = booking.receipts[0];
  const number = receipt?.number ?? `SWM-${booking.id.slice(-6)}`;

  const buffer = await renderToBuffer(
    BookingReceiptPdf({
      number,
      createdAt: receipt?.createdAt ?? booking.createdAt,
      guestName: booking.guestName,
      guestPhone: booking.guestPhone,
      flat: flat(booking.listing),
      city: booking.listing.city,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      checkInTime: booking.listing.checkInTime,
      checkOutTime: booking.listing.checkOutTime,
      nights: nights(booking.checkIn, booking.checkOut),
      guests: booking.guests,
      totalPrice: booking.totalPrice,
      amountPaid: booking.amountPaid,
      due: booking.due,
      source: booking.source,
      policyTitle: policy?.title ?? String(booking.listing.cancellationPolicy),
      policyDescription: policy?.description ?? "Please contact StayWithMe for cancellation details.",
      whatsappNumber: settings.whatsappNumber,
    })
  );

  return pdfResponse(buffer, booking.guestName, booking.checkIn, download);
}
