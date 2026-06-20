// Platform-wide analytics for the admin dashboard. Aggregates over users,
// listings, and the AnalyticsEvent log (populated since Sub-project #3).

import { prisma } from "./db";
import { memo } from "./memo";

// Admin dashboard aggregations are heavy (several groupBy queries). Cache them
// briefly so repeated visits / navigations are snappy. Admin mutations call
// clearMemo(), so the numbers refresh on any real change.
const TTL = 30_000;

export interface PlatformOverview {
  users: number;
  hosts: number;
  listingsByStatus: Record<string, number>;
  totalListings: number;
  views: number;
  whatsappClicks: number;
  saves: number;
}

export interface TopListing {
  id: string;
  title: string;
  city: string;
  views: number;
  whatsappClicks: number;
}

export interface TopHost {
  hostId: string;
  name: string | null;
  email: string;
  listings: number;
  views: number;
}

export function getPlatformOverview(): Promise<PlatformOverview> {
  return memo("admin-overview", TTL, _getPlatformOverview);
}
async function _getPlatformOverview(): Promise<PlatformOverview> {
  const [users, hosts, statusGroups, eventGroups] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { roles: { has: "HOST" } } }),
    prisma.listing.groupBy({ by: ["status"], _count: true }),
    prisma.analyticsEvent.groupBy({ by: ["type"], _count: true }),
  ]);

  const listingsByStatus: Record<string, number> = {};
  let totalListings = 0;
  for (const g of statusGroups) {
    listingsByStatus[g.status] = g._count;
    totalListings += g._count;
  }

  const eventCount = (t: string) =>
    eventGroups.find((g) => g.type === t)?._count ?? 0;

  return {
    users,
    hosts,
    listingsByStatus,
    totalListings,
    views: eventCount("VIEW"),
    whatsappClicks: eventCount("WHATSAPP_CLICK"),
    saves: eventCount("WISHLIST_ADD"),
  };
}

export function getTopListings(limit = 5): Promise<TopListing[]> {
  return memo(`admin-top-listings:${limit}`, TTL, () => _getTopListings(limit));
}
async function _getTopListings(limit: number): Promise<TopListing[]> {
  const grouped = await prisma.analyticsEvent.groupBy({
    by: ["listingId"],
    where: { listingId: { not: null }, type: { in: ["VIEW", "WHATSAPP_CLICK"] } },
    _count: true,
  });

  // Rank by total tracked events, then fetch listing details.
  const ranked = grouped
    .filter((g) => g.listingId)
    .sort((a, b) => b._count - a._count)
    .slice(0, limit);

  const ids = ranked.map((r) => r.listingId as string);
  if (!ids.length) return [];

  const [listings, perType] = await Promise.all([
    prisma.listing.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, city: true },
    }),
    prisma.analyticsEvent.groupBy({
      by: ["listingId", "type"],
      where: { listingId: { in: ids } },
      _count: true,
    }),
  ]);

  const byId = new Map(listings.map((l) => [l.id, l]));
  const count = (id: string, type: string) =>
    perType.find((p) => p.listingId === id && p.type === type)?._count ?? 0;

  return ids
    .map((id) => {
      const l = byId.get(id);
      if (!l) return null;
      return {
        id,
        title: l.title,
        city: l.city,
        views: count(id, "VIEW"),
        whatsappClicks: count(id, "WHATSAPP_CLICK"),
      };
    })
    .filter((x): x is TopListing => x !== null);
}

export function getTopHosts(limit = 5): Promise<TopHost[]> {
  return memo(`admin-top-hosts:${limit}`, TTL, () => _getTopHosts(limit));
}
async function _getTopHosts(limit: number): Promise<TopHost[]> {
  // Aggregate listing counts + views per host.
  const listings = await prisma.listing.findMany({
    select: { id: true, hostId: true },
  });
  const hostByListing = new Map(listings.map((l) => [l.id, l.hostId]));

  const viewGroups = await prisma.analyticsEvent.groupBy({
    by: ["listingId"],
    where: { type: "VIEW", listingId: { not: null } },
    _count: true,
  });

  const stats = new Map<string, { listings: number; views: number }>();
  for (const l of listings) {
    const s = stats.get(l.hostId) ?? { listings: 0, views: 0 };
    s.listings += 1;
    stats.set(l.hostId, s);
  }
  for (const g of viewGroups) {
    const hostId = g.listingId ? hostByListing.get(g.listingId) : undefined;
    if (!hostId) continue;
    const s = stats.get(hostId) ?? { listings: 0, views: 0 };
    s.views += g._count;
    stats.set(hostId, s);
  }

  const topHostIds = [...stats.entries()]
    .sort((a, b) => b[1].views - a[1].views || b[1].listings - a[1].listings)
    .slice(0, limit)
    .map(([hostId]) => hostId);
  if (!topHostIds.length) return [];

  const hosts = await prisma.user.findMany({
    where: { id: { in: topHostIds } },
    select: { id: true, name: true, email: true },
  });
  const hostById = new Map(hosts.map((h) => [h.id, h]));

  return topHostIds
    .map((hostId) => {
      const h = hostById.get(hostId);
      const s = stats.get(hostId)!;
      if (!h) return null;
      return { hostId, name: h.name, email: h.email, listings: s.listings, views: s.views };
    })
    .filter((x): x is TopHost => x !== null);
}
