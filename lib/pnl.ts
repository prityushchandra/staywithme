import { prisma } from "@/lib/db";
import { currentPnlMonth, isListedForPnlMonth } from "@/lib/listing-visibility";
import {
  allocateStaffPay,
  availableDaysOf,
  eachNight,
  emptyExpenseByType,
  icalNightsByMonth,
  monthKeyOf,
  splitStayByMonth,
  todayInIndia,
} from "@/lib/pnl-compute";
import { isExpenseType, PNL_EXPENSE_NATURE, type ExpenseType } from "@/lib/expenses";
import { ICAL_RESERVED_NOTE } from "@/lib/ical";

// Profit & Loss data model. Everything is in MINOR units (paise).
//
// Revenue buckets:
//   - Direct   : confirmed on-platform Bookings (WhatsApp)
//   - Offline  : confirmed OfflineBookings, source OFFLINE
//   - Online   : OnlineEarning monthly entries (Airbnb/Booking.com/…) +
//                confirmed OfflineBookings, source AIRBNB
//
// A stay that crosses a month boundary is split across the months it occupies,
// pro rata by night, so each month reports the business that actually happened
// in it rather than crediting everything to the month of check-in.
// Expenses:
//   - Recorded expenses : Expense rows (rent, electricity, grocery, …) dated to
//                         the month they belong to, entered in the expense tracker.
//                         Only RUNNING costs; one-off SETUP spend is reported
//                         separately and never charged against profit.
//   - Staff             : StaffMonth.pay — a staff member's net pay for the
//                         month, spread evenly across the listed flats that
//                         existed in it. Pay is recorded per staff per month (not per
//                         flat), so it has to be allocated to reach this grid.

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
  // revenue / nights is a meaningful average daily rate. Every night lands in
  // the month it falls in — booking nights alongside the pro-rata share of the
  // stay's money, and iCal-imported Airbnb nights alongside the monthly
  // OnlineEarning figure they belong to.
  nightsDirect: number;
  nightsOffline: number;
  nightsOnline: number;
  // Recorded expenses for this flat + month, split by type. Rent is one of
  // these types, not a special case. RUNNING costs only — setup spend is kept
  // out so it can't distort the month it happened to be paid in.
  expenseByType: Record<ExpenseType, number>;
  // One-off setup spend for this flat + month. Reported, never charged to profit.
  setup: number;
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
  // A process-local memo can outlive a visibility change on another server.
  // Read the listing state and its monthly history afresh for every report.
  const now = new Date();
  const currentMonth = currentPnlMonth(now);
  const [
    listings,
    directBookings,
    offlineBookings,
    onlineEarnings,
    staffMonths,
    allBlocks,
    dotMonths,
    expenses,
  ] = await Promise.all([
    prisma.listing.findMany({
      select: {
        id: true, title: true, flatNumber: true, block: true, createdAt: true,
        status: true, isVisible: true,
        visibilityMonths: { select: { month: true, isVisible: true } },
      },
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
    // Staff pay lives on StaffMonth (per staff, per month). The older
    // per-flat StaffPayroll table is no longer written by anything, so
    // reading it here reported stale pay and understated every month that
    // had been recorded since the payroll model changed.
    prisma.staffMonth.findMany({ select: { month: true, pay: true } }),
    prisma.availabilityBlock.findMany({ select: { listingId: true, startDate: true, endDate: true, kind: true, note: true } }),
    prisma.listingDotMonth.findMany({ select: { listingId: true, month: true, days: true } }),
    prisma.expense.findMany({ select: { listingId: true, month: true, type: true, nature: true, amount: true } }),
  ]);

  const listingMeta = new Map(
    listings.map((l) => [l.id, { label: flatLabel(l), listing: l }])
  );
  function isListed(listingId: string, month: string): boolean {
    const meta = listingMeta.get(listingId);
    return !!meta && isListedForPnlMonth(meta.listing, month, currentMonth);
  }

  // Group availability blocks by flat for the unbooked-day and dot scans.
  const blocksByListing = new Map<string, { startDate: Date; endDate: Date; kind: string }[]>();
  for (const b of allBlocks) {
    const list = blocksByListing.get(b.listingId);
    if (list) list.push(b);
    else blocksByListing.set(b.listingId, [b]);
  }

  // Split every stay across the months it spans before sizing the grid, so a
  // booking that runs past the end of the window still gets a month to land in.
  const directStays = directBookings.map((b) => ({
    booking: b,
    parts: splitStayByMonth(b.checkIn, b.checkOut, Math.max(0, b.totalAmount)),
  }));
  const offlineStays = offlineBookings.map((b) => ({
    booking: b,
    parts: splitStayByMonth(b.checkIn, b.checkOut, Math.max(0, b.totalPrice)),
  }));

  // Hidden future activity must not push historical rows out of the window.
  const keys = [currentMonth];
  for (const s of [...directStays, ...offlineStays]) {
    for (const month of s.parts.keys()) {
      if (isListed(s.booking.listingId, month)) keys.push(month);
    }
  }
  for (const e of onlineEarnings) {
    if (isListed(e.listingId, e.month)) keys.push(e.month);
  }
  for (const s of staffMonths) keys.push(s.month);
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
  function cell(listingId: string, month: string): PnlListingMonth | undefined {
    if (!monthSet.has(month) || !isListed(listingId, month)) return;
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
        expenseByType: emptyExpenseByType(),
        setup: 0,
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

  for (const { booking: b, parts } of directStays) {
    if (!listingMeta.has(b.listingId)) continue;
    for (const [m, part] of parts) {
      const c = cell(b.listingId, m);
      if (!c) continue;
      c.revenueDirect += part.amount;
      c.nightsDirect += part.nights;
    }
    markRecorded(b.listingId, b.checkIn, b.checkOut);
  }
  for (const { booking: b, parts } of offlineStays) {
    if (!listingMeta.has(b.listingId)) continue;
    for (const [m, part] of parts) {
      const c = cell(b.listingId, m);
      if (!c) continue;
      if (b.source === "AIRBNB") {
        c.revenueOnline += part.amount;
        c.nightsOnline += part.nights;
      } else {
        c.revenueOffline += part.amount;
        c.nightsOffline += part.nights;
      }
    }
    markRecorded(b.listingId, b.checkIn, b.checkOut);
  }
  for (const e of onlineEarnings) {
    const c = cell(e.listingId, e.month);
    if (c) c.revenueOnline += Math.max(0, e.amount);
  }
  // Allocate the entire salary to the month's included flats BEFORE building
  // rows. Filtering afterwards would silently lose the hidden flats' shares.
  // Retain the legacy onboarding fallback, but never resurrect an excluded flat.
  const payByMonth = new Map<string, number>();
  for (const s of staffMonths) {
    if (monthSet.has(s.month)) payByMonth.set(s.month, (payByMonth.get(s.month) ?? 0) + Math.max(0, s.pay));
  }
  for (const [month, pay] of payByMonth) {
    if (pay <= 0) continue;
    const endMs = monthStartMs(indexToYm(ymToIndex(month) + 1));
    const included = listings.filter((l) => isListed(l.id, month));
    let eligible = included.filter((l) => l.createdAt.getTime() < endMs).map((l) => l.id);
    if (eligible.length === 0) eligible = included.map((l) => l.id);
    for (const [listingId, share] of allocateStaffPay(pay, eligible)) {
      const c = cell(listingId, month);
      if (c) c.staff += share;
    }
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
    for (const [m, nights] of byMonth) {
      const c = cell(listingId, m);
      if (c) c.nightsOnline += nights;
    }
    // These nights earned money as well, so record them too — otherwise the dot
    // scan below would read an Airbnb-sold day as a day that went unsold.
    for (const b of blocks) markRecorded(listingId, b.startDate, b.endDate);
  }

  // Recorded expenses land in the month they were dated to. Unlike the old
  // rent field, nothing is projected — a month reports what it actually cost.
  //
  // Only RUNNING costs are charged against the month. Setup spend is kept in
  // its own bucket: it buys something that earns across every month that
  // follows, so billing it to the one month it was paid in would show a loss
  // the business never made.
  for (const e of expenses) {
    if (!isExpenseType(e.type)) continue;
    const c = cell(e.listingId, e.month);
    if (!c) continue;
    if (e.nature === PNL_EXPENSE_NATURE) c.expenseByType[e.type] += e.amount;
    else c.setup += e.amount;
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
      const c = cell(l.id, m);
      if (!c) continue;
      const days = availableDaysOf(m, flatBlocks, todayMs);
      c.unbookedDays = days.length;
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
    const c = cell(d.listingId, d.month);
    if (!c) continue;
    c.dots = d.days.length;
    c.unbookedDays = new Set([...(availableDays.get(`${d.listingId}|${d.month}`) ?? []), ...d.days]).size;
  }

  const rows = [...grid.values()].sort(
    (a, b) => a.month.localeCompare(b.month) || a.label.localeCompare(b.label)
  );
  const years = [...new Set(months.map((m) => splitYm(m).year))].sort((a, b) => a - b);
  const includedIds = new Set(rows.map((r) => r.listingId));
  const flats = listings
    .filter((l) => includedIds.has(l.id))
    .map((l) => ({ id: l.id, label: flatLabel(l) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { rows, flats, years, months, currentMonth };
}
