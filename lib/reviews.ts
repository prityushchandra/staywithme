// Reviews — pure rating math + public/admin data access.
// Public reads only ever return APPROVED reviews, mirroring the approval gate
// in lib/data-access.ts so moderation cannot be bypassed page-by-page.

import { prisma } from "./db";
import { memo } from "./memo";
import type { Prisma } from "@prisma/client";

/**
 * Rating aggregates change when a review is created, approved or rejected, and
 * those routes call clearMemo(). unstable_cache is deliberately NOT used here:
 * its on-disk entries survive rebuilds and kept serving a pre-reset average long
 * after the underlying rows had changed, so the header disagreed with the review
 * list right below it. The in-process memo is the single cache layer, with the
 * TTL as a backstop for anything an invalidation misses.
 */
const RATING_TTL_MS = 60_000;

export interface RatingSummary {
  /** Mean rating rounded to 2 decimals; 0 when there are no reviews. */
  average: number;
  count: number;
}

/** Shared rounding so every read path reports the identical number. */
const roundAverage = (value: number) => Math.round(value * 100) / 100;

/**
 * Pure rating aggregation — the single source of truth for how an average is
 * computed and rounded. DB-free so it can be unit-tested like computePricing.
 *
 * Rounded to 2 decimals (Airbnb-style): a listing sitting at 4.97 must not be
 * flattened to "5" in the UI, and "4.3" would hide the difference between 4.25
 * and 4.34 on listings with few reviews.
 */
export function computeRatingSummary(ratings: number[]): RatingSummary {
  if (ratings.length === 0) return { average: 0, count: 0 };
  const sum = ratings.reduce((a, r) => a + r, 0);
  const average = roundAverage(sum / ratings.length);
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

/**
 * Who the review is attributed to. Reviews posted by an admin on a guest's
 * behalf carry no account, only a free-text name.
 */
export function reviewDisplayName(review: {
  authorName: string | null;
  author: { name: string | null } | null;
}): string {
  return review.authorName?.trim() || review.author?.name?.trim() || "Guest";
}

/**
 * Turn the admin's YYYY-MM-DD pick into the review's createdAt.
 *
 * Midday UTC keeps the row on the intended calendar day once rendered in IST,
 * and the clamp stops a "today" pick from landing hours in the future, which
 * would sort it above genuinely newer reviews. An unparseable or missing date
 * falls back to now.
 */
export function resolveReviewDate(date: string | undefined, now: Date = new Date()): Date {
  if (!date) return now;
  const parsed = Date.parse(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed)) return now;
  return new Date(Math.min(parsed, now.getTime()));
}

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

const fetchRatingSummary = async (listingId: string): Promise<RatingSummary> => {
  const rows = await prisma.review.findMany({
    where: { listingId, status: "APPROVED" },
    select: { rating: true },
  });
  return computeRatingSummary(rows.map((r) => r.rating));
};

/** Rating summary for a single listing (APPROVED reviews only). */
export function getRatingSummary(listingId: string): Promise<RatingSummary> {
  return memo(`rating:${listingId}`, RATING_TTL_MS, () => fetchRatingSummary(listingId));
}

/**
 * Rating summaries for many listings in one query, to avoid N+1 in grids.
 * Returns plain entries (a Map isn't serializable through the cache) that
 * callers look up; listings with no approved reviews are absent.
 */
const getRatingSummaryEntries = async (
  listingIds: string[]
): Promise<Array<[string, RatingSummary]>> => {
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
      // Must match computeRatingSummary exactly — a card showing a different
      // number from the detail page would be a visible bug.
      average: roundAverage(g._avg.rating ?? 0),
      count: g._count.rating,
    },
  ]);
};

export async function getRatingSummaries(
  listingIds: string[]
): Promise<Map<string, RatingSummary>> {
  const entries = await memo(
    `rating-summaries:${[...listingIds].sort().join(",")}`,
    RATING_TTL_MS,
    () => getRatingSummaryEntries(listingIds)
  );
  return new Map(entries);
}
