// Public listing reads — the ONLY path public pages use to fetch listings.
// Every query here forces status = PUBLISHED so the approval gate cannot be
// bypassed page-by-page. Draft / Pending / Rejected / Approved-but-unpublished
// listings are never returned to the public.

import { unstable_cache } from "next/cache";
import { prisma } from "./db";
import type { Prisma, Amenity, CancellationPolicyText } from "@prisma/client";
import { getListingStats } from "./analytics";
import { rankListings } from "./ranking";
import { memo, clearMemo } from "./memo";

// Public listing reads change only when a host/admin mutates listings, which
// call revalidateTag("listings"). A short revalidate window is a safety net so
// any missed invalidation self-heals. This keeps warm page loads off the
// remote database (the dominant latency cost).
const LISTINGS_CACHE = { tags: ["listings"], revalidate: 60 };

const publicListingArgs = {
  include: {
    images: { orderBy: { order: "asc" } },
    amenities: { include: { amenity: true } },
    host: { select: { id: true, name: true, image: true, createdAt: true } },
  },
  // Confidential exact-location fields must NEVER reach guests. Omitting them
  // here means the public listing type doesn't even carry them, so no page can
  // accidentally render flatNumber / block.
  omit: { flatNumber: true, block: true },
} satisfies Prisma.ListingDefaultArgs;

export type PublicListing = Prisma.ListingGetPayload<typeof publicListingArgs>;

// Fetch the FULL published set, rank by engagement, and cache the ranked array.
// Ranking the whole set (not a pre-paged slice) is required so pagination pages
// the ranked order. Runs at most once per cache window (tags: ["listings"]).
const cachedRankedListings = unstable_cache(
  async (): Promise<PublicListing[]> => {
    const listings = await prisma.listing.findMany({
      where: { status: "PUBLISHED" },
      ...publicListingArgs,
      orderBy: { createdAt: "desc" },
    });
    const [stats, settings] = await Promise.all([
      getListingStats(listings.map((l) => l.id)),
      // Direct read (NOT the cached getPlatformSettings) — nesting unstable_cache
      // calls can silently disable this cache.
      prisma.platformSettings.findUnique({ where: { id: "singleton" } }),
    ]);
    return rankListings(listings, stats, {
      view: settings?.rankWeightView ?? 1,
      save: settings?.rankWeightSave ?? 3,
      click: settings?.rankWeightClick ?? 5,
    });
  },
  ["ranked-published-listings"],
  LISTINGS_CACHE
);

/** Fetch published listings for public browsing, engagement-ranked. */
export async function getPublishedListings(options?: {
  take?: number;
  skip?: number;
}): Promise<PublicListing[]> {
  const ranked = await memo("ranked-listings", 60_000, () =>
    cachedRankedListings()
  );
  const skip = options?.skip ?? 0;
  const page =
    options?.take !== undefined
      ? ranked.slice(skip, skip + options.take)
      : ranked.slice(skip);
  // Cards only show the cover — don't ship every photo to the grid.
  return page.map((l) => ({ ...l, images: l.images.slice(0, 1) }));
}

const cachedFeaturedListings = unstable_cache(
  async (take: number): Promise<PublicListing[]> => {
    return prisma.listing.findMany({
      where: { status: "PUBLISHED", featured: true },
      ...publicListingArgs,
      orderBy: { createdAt: "desc" },
      take,
    });
  },
  ["featured-listings"],
  LISTINGS_CACHE
);

/** Fetch published, admin-featured listings for the homepage. */
export async function getFeaturedListings(take = 8): Promise<PublicListing[]> {
  const list = await memo(`featured:${take}`, 60_000, () =>
    cachedFeaturedListings(take)
  );
  // Cards only show the cover photo.
  return list.map((l) => ({ ...l, images: l.images.slice(0, 1) }));
}

const cachedListingById = unstable_cache(
  async (id: string): Promise<PublicListing | null> => {
    return prisma.listing.findFirst({
      where: { id, status: "PUBLISHED" },
      ...publicListingArgs,
    });
  },
  ["published-listing-by-id"],
  LISTINGS_CACHE
);

/** Fetch a single published listing by id, or null if not public. */
export async function getPublishedListingById(
  id: string
): Promise<PublicListing | null> {
  const r = await memo(`listing:${id}`, 60_000, () => cachedListingById(id));
  // Never let a transient null (e.g. a cold-DB blip, or a listing published
  // moments ago) stick for the whole TTL — drop it and read once directly so
  // this request gets the real answer instead of a stale "not found".
  if (r === null) {
    clearMemo(`listing:${id}`);
    return prisma.listing.findFirst({ where: { id, status: "PUBLISHED" }, ...publicListingArgs });
  }
  return r;
}

/**
 * Fetch a listing by id regardless of status (no approval gate) — the caller
 * gates on `listing.status`. Used by the listing page so the published/preview
 * decision is based on the CURRENT status, never a stale cached gate.
 */
export async function getListingByIdAnyStatus(
  id: string
): Promise<PublicListing | null> {
  const fetchOne = () =>
    prisma.listing.findUnique({ where: { id }, ...publicListingArgs });
  let r = await memo(`listing-any:${id}`, 60_000, fetchOne);
  if (r === null) {
    // Never let a transient null (cold-DB/cache blip) stick — drop it and read
    // the row directly so the page doesn't false-404.
    clearMemo(`listing-any:${id}`);
    r = await fetchOne();
  }
  return r;
}

// Static reference data used by the host listing form. Cached so create/edit
// pages don't pay extra DB round-trips on every load.
const cachedFormAmenities = unstable_cache(
  async (): Promise<Amenity[]> =>
    prisma.amenity.findMany({ orderBy: { label: "asc" } }),
  ["form-amenities"],
  { tags: ["amenities"], revalidate: 3600 }
);

/** All amenities (id, key, label, icon), cached. */
export function getFormAmenities(): Promise<Amenity[]> {
  return memo("form-amenities", 300_000, () => cachedFormAmenities());
}

const cachedFormBlocks = unstable_cache(
  async (): Promise<string[]> => {
    const rows = await prisma.block.findMany({ orderBy: { name: "asc" }, select: { name: true } });
    return rows.map((b) => b.name);
  },
  ["form-blocks"],
  { tags: ["blocks"], revalidate: 3600 }
);

/** Admin-managed society block names for the listing form, cached. */
export function getFormBlocks(): Promise<string[]> {
  return memo("form-blocks", 300_000, () => cachedFormBlocks());
}

const cachedCancellationPolicies = unstable_cache(
  async (): Promise<CancellationPolicyText[]> =>
    prisma.cancellationPolicyText.findMany(),
  ["cancellation-policies"],
  { tags: ["settings"], revalidate: 600 }
);

/** Cancellation policy texts, cached. */
export function getCancellationPolicies(): Promise<CancellationPolicyText[]> {
  return memo("cancellation-policies", 300_000, () => cachedCancellationPolicies());
}

/** Fetch published listings for a set of ids (used by wishlists). */
export async function getPublishedListingsByIds(
  ids: string[]
): Promise<PublicListing[]> {
  if (!ids.length) return [];
  const list = await prisma.listing.findMany({
    where: { id: { in: ids }, status: "PUBLISHED" },
    ...publicListingArgs,
    orderBy: { createdAt: "desc" },
  });
  // Cards only show the cover photo.
  return list.map((l) => ({ ...l, images: l.images.slice(0, 1) }));
}
