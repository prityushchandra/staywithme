import { prisma } from "@/lib/db";
import { memo } from "@/lib/memo";

// Profit & Loss data model. Everything is in MINOR units (paise).
//
// Revenue buckets:
//   - Direct   : confirmed on-platform Bookings (WhatsApp) — by check-in month
//   - Offline  : confirmed OfflineBookings, source OFFLINE — by check-in month
//   - Online   : OnlineEarning monthly entries (Airbnb/Booking.com/…) +
//                confirmed OfflineBookings, source AIRBNB — by month
// Expenses:
//   - Rent   : Listing.monthlyRent, accrued every month from the flat's first
//              month (createdAt) through the current month
//   - Staff  : StaffPayroll.pay for that flat + month

export interface PnlListingMonth {
  listingId: string;
  label: string;
  month: string; // "YYYY-MM"
  year: number;
  monthIndex: number; // 0-11
  revenueDirect: number;
  revenueOffline: number;
  revenueOnline: number;
  rent: number;
  staff: number;
  // Vacant days in this month for this flat (no booking/block on the calendar),
  // counted only for days that have already elapsed (up to yesterday) and from
  // the flat's creation onward. We track the COUNT only, never a lost-amount.
  unbookedDays: number;
}

export interface PnlData {
  rows: PnlListingMonth[];
  flats: { id: string; label: string }[];
  years: number[];
  months: string[]; // ascending "YYYY-MM"
  currentMonth: string;
}

// How many months of history to keep in the grid (bounds the payload).
const MAX_MONTHS = 48;

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function ymToIndex(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
}
function indexToYm(i: number): string {
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
function splitYm(key: string): { year: number; monthIndex: number } {
  const [y, m] = key.split("-").map(Number);
  return { year: y, monthIndex: m - 1 };
}
function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber?.trim() || l.title;
  return l.block?.trim() ? `${base}, ${l.block.trim()}` : base;
}

const DAY_MS = 86_400_000;
function floorDayUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Count vacant (unbooked) days for one flat in one month: days with NO
 * AvailabilityBlock covering them. Only fully-elapsed days are counted (strictly
 * before today) and never before the flat existed, so future/empty months and
 * pre-launch days don't inflate the number.
 */
function countUnbookedDays(
  monthKeyStr: string,
  blocks: { startDate: Date; endDate: Date }[],
  flatCreatedMs: number,
  todayMs: number
): number {
  const [y, m] = monthKeyStr.split("-").map(Number);
  const monthStart = Date.UTC(y, m - 1, 1);
  const monthEndExclusive = Date.UTC(y, m, 1);
  const startMs = Math.max(monthStart, flatCreatedMs);
  const endMs = Math.min(monthEndExclusive, todayMs); // today excluded (in progress)
  if (endMs <= startMs) return 0;

  let count = 0;
  for (let t = startMs; t < endMs; t += DAY_MS) {
    const booked = blocks.some((b) => b.startDate.getTime() <= t && t < b.endDate.getTime());
    if (!booked) count++;
  }
  return count;
}

export async function getPnlData(): Promise<PnlData> {
  return memo("admin-pnl", 30_000, async () => {
    const [listings, directBookings, offlineBookings, onlineEarnings, staffPayroll, allBlocks] =
      await Promise.all([
        prisma.listing.findMany({
          select: { id: true, title: true, flatNumber: true, block: true, monthlyRent: true, createdAt: true },
        }),
        prisma.booking.findMany({
          where: { status: "CONFIRMED" },
          select: { listingId: true, checkIn: true, totalAmount: true },
        }),
        prisma.offlineBooking.findMany({
          where: { status: "CONFIRMED" },
          select: { listingId: true, checkIn: true, totalPrice: true, source: true },
        }),
        prisma.onlineEarning.findMany({ select: { listingId: true, month: true, amount: true } }),
        prisma.staffPayroll.findMany({ select: { listingId: true, month: true, pay: true } }),
        prisma.availabilityBlock.findMany({ select: { listingId: true, startDate: true, endDate: true } }),
      ]);

    const listingMeta = new Map(
      listings.map((l) => [
        l.id,
        { label: flatLabel(l), monthlyRent: l.monthlyRent ?? 0, createdAt: l.createdAt },
      ])
    );

    // Group availability blocks by flat for the unbooked-day scan.
    const blocksByListing = new Map<string, { startDate: Date; endDate: Date }[]>();
    for (const b of allBlocks) {
      const list = blocksByListing.get(b.listingId);
      if (list) list.push({ startDate: b.startDate, endDate: b.endDate });
      else blocksByListing.set(b.listingId, [{ startDate: b.startDate, endDate: b.endDate }]);
    }

    const now = new Date();
    const currentMonth = monthKey(now);

    // Determine the [min..max] month window from all activity.
    const keys = [currentMonth];
    for (const b of directBookings) keys.push(monthKey(b.checkIn));
    for (const b of offlineBookings) keys.push(monthKey(b.checkIn));
    for (const e of onlineEarnings) keys.push(e.month);
    for (const s of staffPayroll) keys.push(s.month);
    for (const l of listings) keys.push(monthKey(l.createdAt));

    let minIdx = Math.min(...keys.map(ymToIndex));
    const maxIdx = Math.max(...keys.map(ymToIndex));
    if (maxIdx - minIdx + 1 > MAX_MONTHS) minIdx = maxIdx - MAX_MONTHS + 1;

    const months: string[] = [];
    for (let i = minIdx; i <= maxIdx; i++) months.push(indexToYm(i));
    const monthSet = new Set(months);
    const currentIdx = ymToIndex(currentMonth);

    const grid = new Map<string, PnlListingMonth>();
    function cell(listingId: string, month: string): PnlListingMonth {
      const k = `${listingId}|${month}`;
      let c = grid.get(k);
      if (!c) {
        const { year, monthIndex } = splitYm(month);
        c = {
          listingId,
          label: listingMeta.get(listingId)?.label ?? "—",
          month,
          year,
          monthIndex,
          revenueDirect: 0,
          revenueOffline: 0,
          revenueOnline: 0,
          rent: 0,
          staff: 0,
          unbookedDays: 0,
        };
        grid.set(k, c);
      }
      return c;
    }

    for (const b of directBookings) {
      const m = monthKey(b.checkIn);
      if (monthSet.has(m) && listingMeta.has(b.listingId)) cell(b.listingId, m).revenueDirect += Math.max(0, b.totalAmount);
    }
    for (const b of offlineBookings) {
      const m = monthKey(b.checkIn);
      if (!monthSet.has(m) || !listingMeta.has(b.listingId)) continue;
      const c = cell(b.listingId, m);
      if (b.source === "AIRBNB") c.revenueOnline += Math.max(0, b.totalPrice);
      else c.revenueOffline += Math.max(0, b.totalPrice);
    }
    for (const e of onlineEarnings) {
      if (monthSet.has(e.month) && listingMeta.has(e.listingId)) cell(e.listingId, e.month).revenueOnline += Math.max(0, e.amount);
    }
    for (const s of staffPayroll) {
      if (monthSet.has(s.month) && listingMeta.has(s.listingId)) cell(s.listingId, s.month).staff += Math.max(0, s.pay);
    }

    // Rent accrues monthly from the flat's first month through the current month
    // (we don't project rent into future months that carry only upcoming revenue).
    for (const l of listings) {
      const rent = l.monthlyRent ?? 0;
      if (rent <= 0) continue;
      const startIdx = Math.max(minIdx, ymToIndex(monthKey(l.createdAt)));
      for (let i = startIdx; i <= Math.min(maxIdx, currentIdx); i++) {
        cell(l.id, indexToYm(i)).rent += rent;
      }
    }

    // Unbooked (vacant) days per flat per month — over every flat×month in the
    // occupancy window (from the flat's first month to the current month), so the
    // metric appears even for months with no revenue or rent.
    const todayMs = floorDayUtc(now);
    for (const l of listings) {
      const flatBlocks = blocksByListing.get(l.id) ?? [];
      const flatCreatedMs = floorDayUtc(l.createdAt);
      const startIdx = Math.max(minIdx, ymToIndex(monthKey(l.createdAt)));
      for (let i = startIdx; i <= Math.min(maxIdx, currentIdx); i++) {
        const m = indexToYm(i);
        cell(l.id, m).unbookedDays = countUnbookedDays(m, flatBlocks, flatCreatedMs, todayMs);
      }
    }

    const rows = [...grid.values()].sort(
      (a, b) => a.month.localeCompare(b.month) || a.label.localeCompare(b.label)
    );
    const years = [...new Set(months.map((m) => splitYm(m).year))].sort((a, b) => a - b);
    const flats = listings
      .map((l) => ({ id: l.id, label: flatLabel(l) }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return { rows, flats, years, months, currentMonth };
  });
}
