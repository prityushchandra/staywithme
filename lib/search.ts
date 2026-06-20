// Search — builds a Prisma `where` clause from URL-driven filter params over
// published listings. Kept as a pure builder (testable) plus a thin runner, so a
// later move to Postgres full-text / Elasticsearch is a localized change.

import { unstable_cache } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getListingStats } from "./analytics";
import { rankListings } from "./ranking";
import { memo } from "./memo";
import { toUtcDate } from "./dates";

export interface SearchParams {
  destination?: string;
  /** stay dates ("yyyy-mm-dd") — listings blocked for this range are excluded */
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  /** total price per night in RUPEES (what guests see: base + platform fee) */
  minPrice?: number;
  maxPrice?: number;
  roomType?: string[];
  propertyType?: string[];
  bedrooms?: number; // minimum
  bathrooms?: number; // minimum
  amenities?: string[]; // amenity keys — ALL must be present (AND)
}

const ROOM_TYPES = new Set(["ENTIRE", "PRIVATE", "SHARED"]);
const PROPERTY_TYPES = new Set([
  "APARTMENT",
  "HOUSE",
  "VILLA",
  "CABIN",
  "COTTAGE",
  "LOFT",
  "GUESTHOUSE",
]);

/** total rupees -> base price paise, inverting the platform fee. */
function totalRupeesToBasePaise(totalRupees: number, feePercent: number): number {
  return (totalRupees * 100) / (1 + feePercent / 100);
}

/**
 * Build the Prisma where-clause for a search. Always forces PUBLISHED, so the
 * approval gate holds even here.
 */
export function buildListingWhere(
  params: SearchParams,
  platformFeePercent: number
): Prisma.ListingWhereInput {
  const where: Prisma.ListingWhereInput = { status: "PUBLISHED" };
  const and: Prisma.ListingWhereInput[] = [];

  if (params.destination?.trim()) {
    const q = params.destination.trim();
    where.OR = [
      { city: { contains: q, mode: "insensitive" } },
      { country: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
    ];
  }

  if (params.guests && params.guests > 0) {
    where.maxGuests = { gte: params.guests };
  }

  const price: Prisma.IntFilter = {};
  if (params.minPrice && params.minPrice > 0) {
    // Round to nearest paise — avoids float dust (e.g. 99999.999) and ±1-paise
    // differences are immaterial to a price filter.
    price.gte = Math.round(totalRupeesToBasePaise(params.minPrice, platformFeePercent));
  }
  if (params.maxPrice && params.maxPrice > 0) {
    price.lte = Math.round(totalRupeesToBasePaise(params.maxPrice, platformFeePercent));
  }
  if (price.gte !== undefined || price.lte !== undefined) {
    where.basePrice = price;
  }

  const rooms = params.roomType?.filter((r) => ROOM_TYPES.has(r));
  if (rooms?.length) {
    where.roomType = { in: rooms as Prisma.EnumRoomTypeFilter["in"] };
  }

  const props = params.propertyType?.filter((p) => PROPERTY_TYPES.has(p));
  if (props?.length) {
    where.propertyType = { in: props as Prisma.EnumPropertyTypeFilter["in"] };
  }

  if (params.bedrooms && params.bedrooms > 0) {
    where.bedrooms = { gte: params.bedrooms };
  }
  if (params.bathrooms && params.bathrooms > 0) {
    where.bathrooms = { gte: params.bathrooms };
  }

  // Amenities: every requested amenity must be present (AND of `some`).
  const amenityKeys = params.amenities?.filter(Boolean) ?? [];
  for (const key of amenityKeys) {
    and.push({ amenities: { some: { amenity: { key } } } });
  }

  // Availability: when stay dates are given, exclude listings that have any
  // blocked/booked range overlapping [checkIn, checkOut). A block overlaps when
  // it starts before checkout AND ends after check-in.
  if (params.checkIn && params.checkOut) {
    const ci = toUtcDate(params.checkIn);
    const co = toUtcDate(params.checkOut);
    if (co.getTime() > ci.getTime()) {
      and.push({
        availability: { none: { startDate: { lt: co }, endDate: { gt: ci } } },
      });
    }
  }

  if (and.length) where.AND = and;
  return where;
}

const searchArgs = {
  include: {
    images: { orderBy: { order: "asc" } },
    amenities: { include: { amenity: true } },
    host: { select: { id: true, name: true, image: true, createdAt: true } },
  },
  // Same confidential-field guard as the public reads — never expose to guests.
  omit: { flatNumber: true, block: true },
} satisfies Prisma.ListingDefaultArgs;

export type SearchResult = Prisma.ListingGetPayload<typeof searchArgs>;

// Cached across requests: repeated searches (e.g. the common "just dates"
// search, which doesn't filter) skip the remote database. Busted whenever
// listings or reviews change via their tags; a short window self-heals the rest.
const cachedSearch = unstable_cache(
  async (
    _key: string,
    params: SearchParams,
    platformFeePercent: number
  ): Promise<SearchResult[]> => {
    const matches = await prisma.listing.findMany({
      where: buildListingWhere(params, platformFeePercent),
      ...searchArgs,
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const [stats, settings] = await Promise.all([
      getListingStats(matches.map((l) => l.id)),
      // Direct read (NOT cached getPlatformSettings) — avoids nesting caches.
      prisma.platformSettings.findUnique({ where: { id: "singleton" } }),
    ]);

    return rankListings(matches, stats, {
      view: settings?.rankWeightView ?? 1,
      save: settings?.rankWeightSave ?? 3,
      click: settings?.rankWeightClick ?? 5,
    }).slice(0, 60);
  },
  ["search-listings"],
  { tags: ["listings", "reviews"], revalidate: 60 }
);

export async function searchListings(
  params: SearchParams,
  platformFeePercent: number
): Promise<SearchResult[]> {
  const key = `${JSON.stringify(params)}:${platformFeePercent}`;
  const list = await memo(`search:${key}`, 60_000, () =>
    cachedSearch(key, params, platformFeePercent)
  );
  // Cards only show the cover photo.
  return list.map((l) => ({ ...l, images: l.images.slice(0, 1) }));
}

const cachedAmenityOptions = unstable_cache(
  async (): Promise<{ key: string; label: string }[]> => {
    const rows = await prisma.amenity.findMany({ orderBy: { label: "asc" } });
    return rows.map((a) => ({ key: a.key, label: a.label }));
  },
  ["amenity-options"],
  { tags: ["amenities"], revalidate: 3600 }
);

/** Amenity filter options (cached — amenities rarely change). */
export function getAmenityOptions(): Promise<{ key: string; label: string }[]> {
  return memo("amenity-options", 300_000, () => cachedAmenityOptions());
}

const cachedAmenityIdByKey = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const rows = await prisma.amenity.findMany({ select: { id: true, key: true } });
    return Object.fromEntries(rows.map((a) => [a.key, a.id]));
  },
  ["amenity-id-by-key"],
  { tags: ["amenities"], revalidate: 3600 }
);

/** Map of amenity key -> id (cached — saves a DB round-trip on listing save). */
export function getAmenityIdByKey(): Promise<Record<string, string>> {
  return memo("amenity-id-by-key", 300_000, () => cachedAmenityIdByKey());
}
