import { prisma } from "@/lib/db";
import { ICAL_RESERVED_NOTE } from "@/lib/ical";
import { eachNight, floorDayUtc, todayInIndia } from "@/lib/pnl-compute";

// "Dots" are days a flat lost: it was live, it was on the market, nobody booked
// it, and the day ended. They are marked BY HAND rather than derived, because
// only the host knows whether a date was genuinely on sale — Airbnb closes a
// date off once it can no longer be sold, so looking back at the calendar can no
// longer tell "went unsold" apart from "was never offered".
//
// What we can still do is show the host what we DO know about each day, so the
// marking is a confirmation rather than a memory test.

export type DayStatus =
  | "sold" // earned money that day
  | "offMarket" // taken off the market by hand in our app
  | "upcoming" // today or later — still sellable, not lost yet
  | "open" // was on sale, earned nothing, and the day is gone: a dot candidate
  | "preLive"; // before the flat existed

const DAY_MS = 86_400_000;

/** Days in a "YYYY-MM". */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** UTC midnight on the 1st of a "YYYY-MM". */
export function monthStartMs(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return Date.UTC(y, m - 1, 1);
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-\d{2}$/.test(month) && Number(month.slice(5)) >= 1 && Number(month.slice(5)) <= 12;
}

/**
 * What we know about every day of a month for one flat, so the marker can show
 * which days are even candidates. Index 0 is the 1st of the month.
 *
 * Only "open" days can be dots: everything else either earned money, was never
 * offered, or hasn't finished yet.
 */
export function dayStatuses(
  month: string,
  liveFromMs: number,
  blocks: { startDate: Date; endDate: Date; kind: string }[],
  sold: Set<number>,
  todayMs: number
): DayStatus[] {
  const start = monthStartMs(month);
  const n = daysInMonth(month);
  const out: DayStatus[] = [];
  for (let i = 0; i < n; i++) {
    const t = start + i * DAY_MS;
    if (t < liveFromMs) {
      out.push("preLive");
      continue;
    }
    if (sold.has(t)) {
      out.push("sold");
      continue;
    }
    const offMarket = blocks.some(
      (b) => b.kind === "MANUAL" && b.startDate.getTime() <= t && t < b.endDate.getTime()
    );
    if (offMarket) {
      out.push("offMarket");
      continue;
    }
    out.push(t >= todayMs ? "upcoming" : "open");
  }
  return out;
}

/** Keep only real day numbers for the month, deduped and sorted. */
export function cleanDays(days: number[], month: string): number[] {
  const max = daysInMonth(month);
  return [...new Set(days)].filter((d) => Number.isInteger(d) && d >= 1 && d <= max).sort((a, b) => a - b);
}

function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber?.trim() || l.title;
  return l.block?.trim() ? `${base}, ${l.block.trim()}` : base;
}

export interface DotMonthData {
  month: string;
  daysInMonth: number;
  listings: { id: string; label: string }[];
  /** listingId → day-of-month numbers already marked as dots. */
  marked: Record<string, number[]>;
  /** listingId → what we know about each day, index 0 = the 1st. */
  statuses: Record<string, DayStatus[]>;
}

/** Everything the dot marker needs for one month. */
export async function getDotMonthData(month: string): Promise<DotMonthData> {
  const start = new Date(monthStartMs(month));
  const end = new Date(monthStartMs(month) + daysInMonth(month) * DAY_MS);

  const overlaps = { gt: start };
  const [listings, blocks, bookings, offline, dotRows] = await Promise.all([
    prisma.listing.findMany({
      select: { id: true, title: true, flatNumber: true, block: true, createdAt: true },
    }),
    prisma.availabilityBlock.findMany({
      where: { startDate: { lt: end }, endDate: overlaps },
      select: { listingId: true, startDate: true, endDate: true, kind: true, note: true },
    }),
    prisma.booking.findMany({
      where: { status: "CONFIRMED", checkIn: { lt: end }, checkOut: overlaps },
      select: { listingId: true, checkIn: true, checkOut: true },
    }),
    prisma.offlineBooking.findMany({
      where: { status: "CONFIRMED", checkIn: { lt: end }, checkOut: overlaps },
      select: { listingId: true, checkIn: true, checkOut: true },
    }),
    prisma.listingDotMonth.findMany({ where: { month }, select: { listingId: true, days: true } }),
  ]);

  // Every night that earned something, from any channel. Airbnb reservations
  // arrive as imported blocks and are the only record that those nights sold.
  const sold = new Map<string, Set<number>>();
  const add = (listingId: string, checkIn: Date, checkOut: Date) => {
    let set = sold.get(listingId);
    if (!set) sold.set(listingId, (set = new Set<number>()));
    for (const t of eachNight(checkIn, checkOut)) set.add(t);
  };
  for (const b of bookings) add(b.listingId, b.checkIn, b.checkOut);
  for (const b of offline) add(b.listingId, b.checkIn, b.checkOut);
  for (const b of blocks) {
    if (b.kind === "ICAL" && b.note === ICAL_RESERVED_NOTE) add(b.listingId, b.startDate, b.endDate);
  }

  const blocksByListing = new Map<string, { startDate: Date; endDate: Date; kind: string }[]>();
  for (const b of blocks) {
    const list = blocksByListing.get(b.listingId);
    if (list) list.push(b);
    else blocksByListing.set(b.listingId, [b]);
  }

  const todayMs = todayInIndia(new Date());
  const marked: Record<string, number[]> = {};
  const statuses: Record<string, DayStatus[]> = {};
  for (const l of listings) {
    statuses[l.id] = dayStatuses(
      month,
      floorDayUtc(l.createdAt),
      blocksByListing.get(l.id) ?? [],
      sold.get(l.id) ?? new Set<number>(),
      todayMs
    );
    marked[l.id] = dotRows.find((r) => r.listingId === l.id)?.days ?? [];
  }

  return {
    month,
    daysInMonth: daysInMonth(month),
    listings: listings
      .map((l) => ({ id: l.id, label: flatLabel(l) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    marked,
    statuses,
  };
}
