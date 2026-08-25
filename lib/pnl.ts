import { prisma } from "@/lib/db";
import { memo } from "@/lib/memo";
import {
  availableDaysOf,
  eachNight,
  icalNightsByMonth,
  monthKeyOf,
  stayNights,
  todayInIndia,
} from "@/lib/pnl-compute";
import { ICAL_RESERVED_NOTE } from "@/lib/ical";

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
  // Nights actually booked, paired with the revenue bucket above so that
  // revenue / nights is a meaningful average daily rate. Booking-derived nights
  // land in the CHECK-IN month (exactly where their revenue is booked), and
  // iCal-imported Airbnb nights land in the month they fall in (exactly where
  // the monthly OnlineEarning figure they belong to is booked).
  nightsDirect: number;
  nightsOffline: number;
  nightsOnline: number;
  rent: number;
  staff: number;
  // Vacant days that earned nothing: days still open on the calendar (today
  // onward) PLUS dots — days that already ran out of time. See countAvailableDays.
  unbookedDays: number;
  // Days already lost, marked by hand in the dot marker. Included in
  // unbookedDays above, and also reported on their own.
  dots: number;
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
  return monthKeyOf(d.getTime());
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
/** UTC midnight on the 1st of a "YYYY-MM". */
function monthStartMs(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, 1);
}
function flatLabel(l: { title: string; flatNumber: string | null; block: string | null }) {
  const base = l.flatNumber?.trim() || l.title;
  return l.block?.trim() ? `${base}, ${l.block.trim()}` : base;
}

export async function getPnlData(): Promise<PnlData> {
  return memo("admin-pnl", 30_000, async () => {
    const [listings, directBookings, offlineBookings, onlineEarnings, staffPayroll, allBlocks, dotMonths] =
      await Promise.all([
        prisma.listing.findMany({
          select: { id: true, title: true, flatNumber: true, block: true, monthlyRent: true, createdAt: true },
        }),
        prisma.booking.findMany({
          where: { status: "CONFIRMED" },
          select: { listingId: true, checkIn: true, checkOut: true, totalAmount: true },
        }),
        prisma.offlineBooking.findMany({
          where: { status: "CONFIRMED" },
          select: { listingId: true, checkIn: true, checkOut: true, totalPrice: true, source: true },
        }),
        prisma.onlineEarning.findMany({ select: { listingId: true, month: true, amount: true } }),
        prisma.staffPayroll.findMany({ select: { listingId: true, month: true, pay: true } }),
        prisma.availabilityBlock.findMany({ select: { listingId: true, startDate: true, endDate: true, kind: true, note: true } }),
        prisma.listingDotMonth.findMany({ select: { listingId: true, month: true, days: true } }),
      ]);

    const listingMeta = new Map(
      listings.map((l) => [
        l.id,
        { label: flatLabel(l), monthlyRent: l.monthlyRent ?? 0, createdAt: l.createdAt },
      ])
    );

    // Group availability blocks by flat for the unbooked-day and dot scans.
    const blocksByListing = new Map<string, { startDate: Date; endDate: Date; kind: string }[]>();
    for (const b of allBlocks) {
      const list = blocksByListing.get(b.listingId);
      if (list) list.push(b);
      else blocksByListing.set(b.listingId, [b]);
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
    // Extend the window through the END of the current financial year (March), so
    // upcoming months in this FY exist in the grid and their still-available days
    // show up in the "unbooked" (available) metric.
    const [cy, cm] = currentMonth.split("-").map(Number);
    const currentFyStart = cm >= 4 ? cy : cy - 1;
    const fyEndIdx = ymToIndex(`${currentFyStart + 1}-03`);
    const maxIdx = Math.max(...keys.map(ymToIndex), fyEndIdx);
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
          nightsDirect: 0,
          nightsOffline: 0,
          nightsOnline: 0,
          rent: 0,
          staff: 0,
          unbookedDays: 0,
          dots: 0,
        };
        grid.set(k, c);
      }
      return c;
    }

    // Every night covered by a booking we hold a record for, so an Airbnb stay
    // that was ALSO entered by hand isn't counted twice against the iCal feed.
    const recordedNights = new Map<string, Set<number>>();
    function markRecorded(listingId: string, checkIn: Date, checkOut: Date) {
      let set = recordedNights.get(listingId);
      if (!set) {
        set = new Set<number>();
        recordedNights.set(listingId, set);
      }
      for (const t of eachNight(checkIn, checkOut)) set.add(t);
    }

    for (const b of directBookings) {
      const m = monthKey(b.checkIn);
      if (!monthSet.has(m) || !listingMeta.has(b.listingId)) continue;
      const c = cell(b.listingId, m);
      c.revenueDirect += Math.max(0, b.totalAmount);
      c.nightsDirect += stayNights(b.checkIn, b.checkOut);
      markRecorded(b.listingId, b.checkIn, b.checkOut);
    }
    for (const b of offlineBookings) {
      const m = monthKey(b.checkIn);
      if (!monthSet.has(m) || !listingMeta.has(b.listingId)) continue;
      const c = cell(b.listingId, m);
      const nights = stayNights(b.checkIn, b.checkOut);
      if (b.source === "AIRBNB") {
        c.revenueOnline += Math.max(0, b.totalPrice);
        c.nightsOnline += nights;
      } else {
        c.revenueOffline += Math.max(0, b.totalPrice);
        c.nightsOffline += nights;
      }
      markRecorded(b.listingId, b.checkIn, b.checkOut);
    }
    for (const e of onlineEarnings) {
      if (monthSet.has(e.month) && listingMeta.has(e.listingId)) cell(e.listingId, e.month).revenueOnline += Math.max(0, e.amount);
    }
    for (const s of staffPayroll) {
      if (monthSet.has(s.month) && listingMeta.has(s.listingId)) cell(s.listingId, s.month).staff += Math.max(0, s.pay);
    }

    // Airbnb reservations imported from the iCal feed carry no money of their own
    // — that arrives as the monthly OnlineEarning figure — but they are the only
    // record of how many nights that money covered, so they supply the denominator
    // for the online average daily rate. Dates the host merely BLOCKED on Airbnb
    // are imported too and must be excluded: they earned nothing, and counting
    // them would silently drag the average rate down.
    const windowStartMs = monthStartMs(months[0]);
    const windowEndMs = monthStartMs(indexToYm(maxIdx + 1));
    const icalByListing = new Map<string, { startDate: Date; endDate: Date }[]>();
    for (const b of allBlocks) {
      if (b.kind !== "ICAL" || b.note !== ICAL_RESERVED_NOTE || !listingMeta.has(b.listingId)) continue;
      const list = icalByListing.get(b.listingId);
      if (list) list.push(b);
      else icalByListing.set(b.listingId, [b]);
    }
    for (const [listingId, blocks] of icalByListing) {
      const recorded = recordedNights.get(listingId) ?? new Set<number>();
      const byMonth = icalNightsByMonth(blocks, recorded, windowStartMs, windowEndMs);
      for (const [m, nights] of byMonth) cell(listingId, m).nightsOnline += nights;
      // These nights earned money as well, so record them too — otherwise the dot
      // scan below would read an Airbnb-sold day as a day that went unsold.
      for (const b of blocks) markRecorded(listingId, b.startDate, b.endDate);
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

    // Available (still-bookable) days per flat per month — from the current month
    // through the end of the window (future months in this FY). Past months are
    // left at 0 (nothing is "available" to book in the past).
    const todayMs = todayInIndia(now);
    const availableDays = new Map<string, number[]>();
    for (const l of listings) {
      const flatBlocks = blocksByListing.get(l.id) ?? [];
      for (let i = Math.max(minIdx, currentIdx); i <= maxIdx; i++) {
        const m = indexToYm(i);
        const days = availableDaysOf(m, flatBlocks, todayMs);
        cell(l.id, m).unbookedDays = days.length;
        availableDays.set(`${l.id}|${m}`, days);
      }
    }

    // Dots — days each flat lost, marked by hand in the dot marker. Not derived:
    // Airbnb shuts a date off once it can no longer be sold, so after the fact
    // the calendar can't tell "went unsold" from "was never offered".
    //
    // A dot is an unbooked day too, so it joins the available days to make
    // "unbooked" mean every day that earned nothing, past and future. Taking the
    // union rather than the sum matters: today can be BOTH still-bookable and
    // already written off by hand, and it must only count once.
    for (const d of dotMonths) {
      if (!monthSet.has(d.month) || !listingMeta.has(d.listingId)) continue;
      const c = cell(d.listingId, d.month);
      c.dots = d.days.length;
      c.unbookedDays = new Set([...(availableDays.get(`${d.listingId}|${d.month}`) ?? []), ...d.days]).size;
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
