import { prisma } from "@/lib/db";
import { buildIcalFeed } from "@/lib/ical";

export const dynamic = "force-dynamic";

// Public iCal feed of this listing's busy dates (our own manual blocks + booked
// stays) so Airbnb / Vrbo / Booking.com can IMPORT it and block those dates on
// their side. Deliberately unauthenticated — external platforms poll it with no
// credentials, and it only exposes busy dates (already visible on the listing
// page). External calendars refresh on their own schedule (Airbnb ~hourly), so
// this is near-real-time, not instant.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { id: true, title: true },
  });
  if (!listing) return new Response("Not found", { status: 404 });

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // Export our OWN blocks (manual holds + confirmed bookings). We don't re-export
  // ICAL-imported blocks (those already live on the source platform).
  const blocks = await prisma.availabilityBlock.findMany({
    where: { listingId: id, kind: { in: ["MANUAL", "BOOKING"] }, endDate: { gt: todayUtc } },
    select: { id: true, startDate: true, endDate: true, kind: true },
    orderBy: { startDate: "asc" },
  });

  const events = blocks.map((b) => ({
    uid: `swm-${b.id}@staywithme.co.in`,
    start: b.startDate,
    end: b.endDate,
    summary: b.kind === "BOOKING" ? "Reserved (StayWithMe)" : "Blocked (StayWithMe)",
  }));

  const ics = buildIcalFeed(events, `StayWithMe — ${listing.title}`);
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="staywithme-${listing.id}.ics"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
