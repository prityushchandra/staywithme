import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlatformSettings } from "@/lib/settings";
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

// Booking receipt as a PDF (flows to any length — never cropped).
// Access: admin session, OR a guest link carrying the booking's unguessable ?t=<publicToken>.
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
          wifiName: true, wifiPassword: true, checkInTime: true, checkOutTime: true,
          cancellationPolicy: true,
        },
      },
      receipts: { select: { number: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

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
      wifiName: booking.listing.wifiName,
      wifiPassword: booking.listing.wifiPassword,
      policyTitle: policy?.title ?? String(booking.listing.cancellationPolicy),
      policyDescription: policy?.description ?? "Please contact StayWithMe for cancellation details.",
      smartLockNote: settings.smartLockNote ?? "Check-in details will be shared before arrival.",
      whatsappNumber: settings.whatsappNumber,
    })
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="StayWithMe-${number.replace(/[^A-Za-z0-9._-]/g, "")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
