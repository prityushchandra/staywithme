// Lightweight analytics. Records events into AnalyticsEvent and aggregates them
// per host. (Funnels, CTR, time-series, and anti-gaming come in Sub-project #6;
// this just starts collecting and exposes simple counts.)

import { prisma } from "./db";
import { memo } from "./memo";

export type EventType =
  | "VIEW"
  | "WHATSAPP_CLICK"
  | "WISHLIST_ADD"
  | "SEARCH_IMPRESSION";

const TRACKABLE: EventType[] = ["VIEW", "WHATSAPP_CLICK", "WISHLIST_ADD"];

export function isTrackableClientEvent(t: string): t is EventType {
  return (TRACKABLE as string[]).includes(t);
}

export async function recordEvent(
  type: EventType,
  opts: { listingId?: string; userId?: string; metadata?: Record<string, unknown> } = {}
) {
  try {
    await prisma.analyticsEvent.create({
      data: {
        type,
        listingId: opts.listingId ?? null,
        userId: opts.userId ?? null,
        metadata: opts.metadata ? (opts.metadata as object) : undefined,
      },
    });
  } catch {
    // Analytics must never break a user flow — swallow errors.
  }
}

export interface ListingStats {
  views: number;
  whatsappClicks: number;
  saves: number;
}

/** Per-listing counts for a set of listing ids, keyed by listingId (cached). */
export function getListingStats(
  listingIds: string[]
): Promise<Record<string, ListingStats>> {
  return memo(
    `listing-stats:${[...listingIds].sort().join(",")}`,
    30_000,
    () => computeListingStats(listingIds)
  );
}

async function computeListingStats(
  listingIds: string[]
): Promise<Record<string, ListingStats>> {
  const base: Record<string, ListingStats> = {};
  for (const id of listingIds) base[id] = { views: 0, whatsappClicks: 0, saves: 0 };
  if (!listingIds.length) return base;

  const grouped = await prisma.analyticsEvent.groupBy({
    by: ["listingId", "type"],
    where: { listingId: { in: listingIds } },
    _count: true,
  });

  for (const row of grouped) {
    if (!row.listingId || !base[row.listingId]) continue;
    const stats = base[row.listingId];
    if (row.type === "VIEW") stats.views = row._count;
    else if (row.type === "WHATSAPP_CLICK") stats.whatsappClicks = row._count;
    else if (row.type === "WISHLIST_ADD") stats.saves = row._count;
  }
  return base;
}

export function sumStats(all: Record<string, ListingStats>): ListingStats {
  return Object.values(all).reduce(
    (acc, s) => ({
      views: acc.views + s.views,
      whatsappClicks: acc.whatsappClicks + s.whatsappClicks,
      saves: acc.saves + s.saves,
    }),
    { views: 0, whatsappClicks: 0, saves: 0 }
  );
}
