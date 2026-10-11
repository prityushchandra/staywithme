import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { computePricing, computeStayBase } from "@/lib/pricing";
import { isRangeAvailable, toUtcDate } from "@/lib/dates";

// Live price + availability re-check, called the moment a guest presses Reserve.
//
// The listing page is ISR-cached, so `basePrice`, `monthlyPrice`,
// `platformFeePercent` and the blocked nights were baked into the HTML when the
// page was last rendered. A guest can therefore sit on a stale page and reserve
// nights that were booked minutes ago, at yesterday's price. This route is the
// authority that catches that.
//
// It MUST stay genuinely live, so it reads straight through prisma and
// deliberately avoids every caching layer in this repo:
//   - no `lib/data-access.ts` helpers (wrapped in `unstable_cache`, tag "listings")
//   - no `getActiveBlocks()` from `lib/availability.ts` (60s `lib/memo.ts` TTL)
//   - no `getPlatformSettings()` from `lib/settings.ts` (`unstable_cache`, tag "settings")
// Those are exactly the layers that would hand back the stale numbers we are
// trying to detect.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Longest stay we will quote — a cheap guard against silly ranges. */
const MAX_NIGHTS = 365;
/** Mirrors the PlatformSettings default, for the (impossible) missing-row case. */
const DEFAULT_PLATFORM_FEE_PERCENT = 10;
const DAY_MS = 86_400_000;

const quoteSchema = z.object({
  checkIn: z.string().min(8).max(40),
  checkOut: z.string().min(8).max(40),
  guests: z.coerce.number().int().min(1).max(50).default(1),
  infants: z.coerce.number().int().min(0).max(20).default(0),
});

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/**
 * POST /api/listings/[id]/quote
 *
 * Public and unauthenticated, so it returns only figures the booking card
 * already shows a guest: price, fee percent, stay total, whether the range is
 * still free, and the current blocked ranges. No host identity, no payout data,
 * no private notes.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = quoteSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid request.");

  const checkIn = toUtcDate(parsed.data.checkIn);
  const checkOut = toUtcDate(parsed.data.checkOut);
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    return badRequest("Invalid dates.");
  }
  if (checkOut.getTime() <= checkIn.getTime()) {
    return badRequest("Check-out must be after check-in.");
  }
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
  if (nights > MAX_NIGHTS) return badRequest("That stay is too long to quote.");

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { status: true, basePrice: true, monthlyPrice: true },
  });
  // Drafts, pending and rejected listings are invisible to guests — same 404 as
  // a listing that doesn't exist, so this can't be used to probe for them.
  if (!listing || listing.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  // Same window as the calendar's own read (endDate strictly after today UTC),
  // so the server and the card are looking at the same set of nights.
  const todayUtc = toUtcDate(new Date());
  const [blocks, settings] = await Promise.all([
    prisma.availabilityBlock.findMany({
      where: { listingId: id, endDate: { gt: todayUtc } },
      select: { startDate: true, endDate: true },
      orderBy: { startDate: "asc" },
    }),
    prisma.platformSettings.findUnique({
      where: { id: "singleton" },
      select: { platformFeePercent: true },
    }),
  ]);

  const platformFeePercent =
    settings?.platformFeePercent ?? DEFAULT_PLATFORM_FEE_PERCENT;

  // Reuse the card's own maths rather than re-deriving it: a rounding
  // difference here would surface as a phantom "prices have been updated".
  const { total } = computePricing(
    computeStayBase(listing.basePrice, listing.monthlyPrice, nights),
    { platformFeePercent }
  );

  return NextResponse.json(
    {
      available: isRangeAvailable(checkIn, checkOut, blocks),
      nights,
      basePrice: listing.basePrice,
      monthlyPrice: listing.monthlyPrice,
      platformFeePercent,
      total,
      status: listing.status,
      blockedRanges: blocks.map((b) => ({
        startDate: b.startDate.toISOString(),
        endDate: b.endDate.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
