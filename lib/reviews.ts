// Reviews — pure rating math + public/admin data access.
// Public reads only ever return APPROVED reviews, mirroring the approval gate
// in lib/data-access.ts so moderation cannot be bypassed page-by-page.

import { unstable_cache } from "next/cache";
import { prisma } from "./db";
import { memo } from "./memo";
import type { Prisma } from "@prisma/client";

// Rating aggregates change only when a review is approved/rejected, which calls
// revalidateTag("reviews"). Cached so listing grids and detail headers don't pay
// a database round-trip on every load.
const REVIEWS_CACHE = { tags: ["reviews"], revalidate: 60 };

export interface RatingSummary {
  /** Mean rating rounded to 1 decimal; 0 when there are no reviews. */
  average: number;
  count: number;
}

/**
 * Pure rating aggregation — the single source of truth for how an average is
 * computed and rounded. DB-free so it can be unit-tested like computePricing.
 */
export function computeRatingSummary(ratings: number[]): RatingSummary {
  if (ratings.length === 0) return { average: 0, count: 0 };
  const sum = ratings.reduce((a, r) => a + r, 0);
  const average = Math.round((sum / ratings.length) * 10) / 10;
  return { average, count: ratings.length };
}

/**
 * Has this guest actually completed a stay at this listing? True only when they
 * have a CONFIRMED booking whose check-out has already passed. This is the
 * default gate for who may leave a review (admin can override platform-wide).
 */
export async function hasCompletedStay(
  userId: string,
  listingId: string
): Promise<boolean> {
  const stay = await prisma.booking.findFirst({
    where: {
      guestId: userId,
      listingId,
      status: "CONFIRMED",
      checkOut: { lte: new Date() },
    },
    select: { id: true },
  });
  return Boolean(stay);
}

const reviewAuthorInclude = {
  author: { select: { id: true, name: true, image: true } },
} satisfies Prisma.ReviewInclude;

export type ApprovedReview = Prisma.ReviewGetPayload<{
  include: typeof reviewAuthorInclude;
}>;

/** Approved reviews for a listing, newest first, with author info (cached). */
export function getApprovedReviews(
  listingId: string
): Promise<ApprovedReview[]> {
  return memo(`approved-reviews:${listingId}`, 60_000, () =>
    prisma.review.findMany({
      where: { listingId, status: "APPROVED" },
      include: reviewAuthorInclude,
      orderBy: { createdAt: "desc" },
    })
  );
}

const cachedRatingSummary = unstable_cache(
  async (listingId: string): Promise<RatingSummary> => {
    const rows = await prisma.review.findMany({
      where: { listingId, status: "APPROVED" },
      select: { rating: true },
    });
    return computeRatingSummary(rows.map((r) => r.rating));
  },
  ["rating-summary"],
  REVIEWS_CACHE
);

/** Rating summary for a single listing (APPROVED reviews only). */
export function getRatingSummary(listingId: string): Promise<RatingSummary> {
  return memo(`rating:${listingId}`, 60_000, () => cachedRatingSummary(listingId));
}

/**
 * Rating summaries for many listings in one query, to avoid N+1 in grids.
 * Returns plain entries (a Map isn't serializable through the cache) that
 * callers look up; listings with no approved reviews are absent.
 */
const getRatingSummaryEntries = unstable_cache(
  async (listingIds: string[]): Promise<Array<[string, RatingSummary]>> => {
    if (listingIds.length === 0) return [];

    const groups = await prisma.review.groupBy({
      by: ["listingId"],
      where: { listingId: { in: listingIds }, status: "APPROVED" },
      _avg: { rating: true },
      _count: { rating: true },
    });

    return groups.map((g) => [
      g.listingId,
      {
        average: Math.round((g._avg.rating ?? 0) * 10) / 10,
        count: g._count.rating,
      },
    ]);
  },
  ["rating-summaries"],
  REVIEWS_CACHE
);

export async function getRatingSummaries(
  listingIds: string[]
): Promise<Map<string, RatingSummary>> {
  const entries = await memo(
    `rating-summaries:${[...listingIds].sort().join(",")}`,
    60_000,
    () => getRatingSummaryEntries(listingIds)
  );
  return new Map(entries);
}
