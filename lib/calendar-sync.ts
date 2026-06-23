// External calendar (iCal) import. Fetches a listing's Airbnb/Vrbo/etc. .ics
// export, parses busy ranges, and mirrors them as AvailabilityBlock rows of kind
// "ICAL" so those dates show as unavailable here and can't be double-booked.
// Re-syncing fully replaces the prior ICAL blocks (so a freed Airbnb date frees
// up here too) without touching our own MANUAL/BOOKING blocks.

import { revalidateTag } from "next/cache";
import { prisma } from "./db";
import { clearMemo } from "./memo";
import { isSafeIcalUrl, parseIcalBusyRanges } from "./ical";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;

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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(listing.icalUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "StayWithMe-Calendar/1.0", Accept: "text/calendar, text/plain" },
    });
    clearTimeout(timer);
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
  clearMemo();
  return { ok: true, count: ranges.length };
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
