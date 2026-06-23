// External calendar (iCal) import. Fetches a listing's Airbnb/Vrbo/etc. .ics
// export, parses busy ranges, and mirrors them as AvailabilityBlock rows of kind
// "ICAL" so those dates show as unavailable here and can't be double-booked.
// Re-syncing fully replaces the prior ICAL blocks (so a freed Airbnb date frees
// up here too) without touching our own MANUAL/BOOKING blocks.

import dns from "node:dns/promises";
import { revalidateTag } from "next/cache";
import { prisma } from "./db";
import { clearMemo } from "./memo";
import { isSafeIcalUrl, isPrivateIp, parseIcalBusyRanges } from "./ical";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 4;

// Reject a host that resolves to any loopback/private/link-local address. Run
// immediately before each fetch hop so an encoded IP, a domain pointing at an
// internal IP, or a redirect to one is caught (narrows DNS-rebinding to a tiny
// window — re-resolved on every hop).
async function assertHostResolvesPublic(host: string): Promise<void> {
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length) throw new Error("could not resolve host");
  for (const r of records) {
    if (isPrivateIp(r.address)) throw new Error("host resolves to a private address");
  }
}

// SSRF-safe fetch: validate the URL + resolved IPs on every hop, following
// redirects manually (max MAX_REDIRECTS) so a 3xx can't bounce us to an internal
// address. Throws on any unsafe URL / private resolution / redirect loop.
async function safeFetchIcal(initialUrl: string): Promise<Response> {
  let url = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isSafeIcalUrl(url)) throw new Error("unsafe url");
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    await assertHostResolvesPublic(host);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": "StayWithMe-Calendar/1.0", Accept: "text/calendar, text/plain" },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      url = new URL(location, url).toString(); // re-validated at the top of the loop
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

type SyncResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

async function fail(listingId: string, error: string): Promise<SyncResult> {
  await prisma.listing
    .update({ where: { id: listingId }, data: { icalError: error } })
    .catch(() => {});
  return { ok: false, error };
}

/** Pull one listing's external calendar and replace its imported blocks. */
export async function syncListingCalendar(listingId: string): Promise<SyncResult> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, icalUrl: true },
  });
  if (!listing?.icalUrl) return { ok: false, error: "No calendar link set." };
  if (!isSafeIcalUrl(listing.icalUrl))
    return fail(listingId, "That calendar link must be a valid https URL.");

  let text: string;
  try {
    const res = await safeFetchIcal(listing.icalUrl);
    if (!res.ok) return fail(listingId, `Couldn't fetch the calendar (HTTP ${res.status}).`);
    text = (await res.text()).slice(0, MAX_BYTES);
  } catch {
    return fail(listingId, "Couldn't reach that calendar link. Double-check the URL.");
  }

  if (!/BEGIN:VCALENDAR/i.test(text))
    return fail(listingId, "That link didn't return a calendar (.ics) feed.");

  const ranges = parseIcalBusyRanges(text);

  // Replace all prior imported blocks atomically; leave MANUAL/BOOKING untouched.
  await prisma.$transaction([
    prisma.availabilityBlock.deleteMany({ where: { listingId, kind: "ICAL" } }),
    ...(ranges.length
      ? [
          prisma.availabilityBlock.createMany({
            data: ranges.map((r) => ({
              listingId,
              startDate: r.start,
              endDate: r.end,
              kind: "ICAL",
              note: "Imported from Airbnb",
            })),
          }),
        ]
      : []),
    prisma.listing.update({
      where: { id: listingId },
      data: { icalSyncedAt: new Date(), icalError: null },
    }),
  ]);

  revalidateTag("listings");
  // Invalidate only THIS listing's cached blocks — syncing on every owner view
  // shouldn't wipe the whole in-process cache.
  clearMemo(`active-blocks:${listingId}`);
  return { ok: true, count: ranges.length };
}

/**
 * Sync only if the listing's calendar is older than `maxAgeMs` (or never synced).
 * Lets pages refresh external availability on view without re-fetching Airbnb on
 * every single request. Never throws — a failed sync leaves the last data in
 * place and records icalError.
 */
export async function syncListingCalendarIfStale(
  listingId: string,
  maxAgeMs: number
): Promise<void> {
  const l = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { icalUrl: true, icalSyncedAt: true },
  });
  if (!l?.icalUrl) return;
  const fresh = l.icalSyncedAt && Date.now() - l.icalSyncedAt.getTime() < maxAgeMs;
  if (fresh) return;
  await syncListingCalendar(listingId).catch(() => {});
}

/** Sync every listing that has a calendar link (used by the daily cron). */
export async function runAllCalendarSync(): Promise<{ synced: number; failed: number }> {
  const listings = await prisma.listing.findMany({
    where: { icalUrl: { not: null } },
    select: { id: true },
  });
  let synced = 0;
  let failed = 0;
  for (const l of listings) {
    const r = await syncListingCalendar(l.id);
    if (r.ok) synced++;
    else failed++;
  }
  return { synced, failed };
}
