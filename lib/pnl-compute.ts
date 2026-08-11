import type { PnlListingMonth } from "./pnl";

// Pure P&L aggregation (no DB) so the admin page and the Excel export produce
// identical numbers. All money is in paise.

export interface PnlSummary {
  revenueDirect: number;
  revenueOffline: number;
  revenueOnline: number;
  revenueTotal: number;
  nightsDirect: number;
  nightsOffline: number;
  nightsOnline: number;
  nightsTotal: number;
  rent: number;
  staff: number;
  expenseTotal: number;
  profit: number;
  margin: number; // profit / revenue, as a percentage (0 when no revenue)
  unbookedDays: number;
}

// Revenue-channel filter used across the P&L tab. "offline" bundles our own
// direct/walk-in bookings; "online" is Airbnb; "both" is everything.
export type PnlSource = "both" | "online" | "offline";

const DAY_MS = 86_400_000;

/** UTC midnight of the day `d` falls on. */
export function floorDayUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** "YYYY-MM" for a UTC timestamp. */
export function monthKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Nights in a stay. Clamped to at least 1 so a same-day (or malformed) record
 * still counts as a booked day — a 0 would otherwise pull revenue into the
 * average daily rate with nothing to divide it by.
 */
export function stayNights(checkIn: Date, checkOut: Date): number {
  return Math.max(1, Math.round((floorDayUtc(checkOut) - floorDayUtc(checkIn)) / DAY_MS));
}

/** Every night a stay occupies, as UTC day timestamps. */
export function eachNight(checkIn: Date, checkOut: Date): number[] {
  const out: number[] = [];
  const end = floorDayUtc(checkOut);
  for (let t = floorDayUtc(checkIn); t < end; t += DAY_MS) out.push(t);
  return out;
}

/**
 * Nights per month from Airbnb reservations imported over iCal.
 *
 * Those blocks carry no money of their own — that arrives as the monthly
 * OnlineEarning figure — but they are the only record of how many nights that
 * money covered, so they supply the denominator for the online daily rate.
 * Nights land in the month they actually fall in, matching how the monthly
 * earning figure is booked. Days already covered by a booking we hold a record
 * for are skipped, so an Airbnb stay that was ALSO entered by hand isn't
 * counted twice.
 */
export function icalNightsByMonth(
  blocks: { startDate: Date; endDate: Date }[],
  recorded: Set<number>,
  windowStartMs: number,
  windowEndMs: number
): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of blocks) {
    const from = Math.max(floorDayUtc(b.startDate), windowStartMs);
    const to = Math.min(floorDayUtc(b.endDate), windowEndMs);
    for (let t = from; t < to; t += DAY_MS) {
      if (recorded.has(t)) continue;
      const key = monthKeyOf(t);
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}

/** Revenue for the chosen channel from a summary's buckets. */
export function sourceRevenue(
  s: { revenueOnline: number; revenueOffline: number; revenueDirect: number },
  source: PnlSource
): number {
  if (source === "online") return s.revenueOnline;
  if (source === "offline") return s.revenueOffline + s.revenueDirect;
  return s.revenueOnline + s.revenueOffline + s.revenueDirect;
}

/** Booked nights for the chosen channel — the denominator of the daily rate. */
export function sourceNights(
  s: { nightsOnline: number; nightsOffline: number; nightsDirect: number },
  source: PnlSource
): number {
  if (source === "online") return s.nightsOnline;
  if (source === "offline") return s.nightsOffline + s.nightsDirect;
  return s.nightsOnline + s.nightsOffline + s.nightsDirect;
}

/**
 * Average daily rate: what a booked day actually earned, in paise.
 *
 * `null` when nothing was booked — a flat with revenue but no recorded nights
 * (e.g. an Airbnb payout entered with no calendar synced) has no meaningful
 * average, and showing 0 would read as "earned nothing" rather than "unknown".
 */
export function avgPerDay(
  s: {
    revenueOnline: number;
    revenueOffline: number;
    revenueDirect: number;
    nightsOnline: number;
    nightsOffline: number;
    nightsDirect: number;
  },
  source: PnlSource
): number | null {
  const nights = sourceNights(s, source);
  if (nights <= 0) return null;
  return Math.round(sourceRevenue(s, source) / nights);
}

export function summarize(rows: PnlListingMonth[]): PnlSummary {
  let revenueDirect = 0;
  let revenueOffline = 0;
  let revenueOnline = 0;
  let nightsDirect = 0;
  let nightsOffline = 0;
  let nightsOnline = 0;
  let rent = 0;
  let staff = 0;
  let unbookedDays = 0;
  for (const r of rows) {
    revenueDirect += r.revenueDirect;
    revenueOffline += r.revenueOffline;
    revenueOnline += r.revenueOnline;
    nightsDirect += r.nightsDirect;
    nightsOffline += r.nightsOffline;
    nightsOnline += r.nightsOnline;
    rent += r.rent;
    staff += r.staff;
    unbookedDays += r.unbookedDays;
  }
  const revenueTotal = revenueDirect + revenueOffline + revenueOnline;
  const nightsTotal = nightsDirect + nightsOffline + nightsOnline;
  const expenseTotal = rent + staff;
  const profit = revenueTotal - expenseTotal;
  const margin = revenueTotal > 0 ? (profit / revenueTotal) * 100 : 0;
  return {
    revenueDirect,
    revenueOffline,
    revenueOnline,
    revenueTotal,
    nightsDirect,
    nightsOffline,
    nightsOnline,
    nightsTotal,
    rent,
    staff,
    expenseTotal,
    profit,
    margin,
    unbookedDays,
  };
}

/** Source-scoped {revenue, profit, margin, nights, avgPerDay} for a summary. Expenses are fixed. */
export function scopeSummary(
  s: PnlSummary,
  source: PnlSource
): { revenue: number; profit: number; margin: number; nights: number; avgPerDay: number | null } {
  const revenue = sourceRevenue(s, source);
  const profit = revenue - s.expenseTotal;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  return { revenue, profit, margin, nights: sourceNights(s, source), avgPerDay: avgPerDay(s, source) };
}

// --- Indian financial year (April 1 – March 31) ----------------------------

/** The FY START year for a "YYYY-MM": Apr–Dec → that year, Jan–Mar → year−1. */
export function financialYearStart(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

/** Label like "FY 2026-27" for a FY starting in `startYear`. */
export function financialYearLabel(startYear: number): string {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Distinct FY start-years present in the given months, ascending. */
export function financialYearsFromMonths(months: string[]): number[] {
  return [...new Set(months.map(financialYearStart))].sort((a, b) => a - b);
}

/** The 12 month keys of a FY, in order Apr(start) … Mar(start+1). */
export function monthsOfFinancialYear(startYear: number): string[] {
  const out: string[] = [];
  for (let k = 0; k < 12; k++) {
    const idx = (startYear * 12 + 3) + k; // April = month index 3
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

/** Rows within a FY, optionally narrowed to a single "YYYY-MM" month. */
export function filterFinancialYear(rows: PnlListingMonth[], fyStart: number, month?: string): PnlListingMonth[] {
  return rows.filter((r) => financialYearStart(r.month) === fyStart && (!month || r.month === month));
}

export interface PnlMonthly extends PnlSummary {
  month: string;
  label: string;
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** One summary row per month key (keeps a continuous axis even for empty months). */
export function monthlyBreakdown(rows: PnlListingMonth[], monthKeys: string[]): PnlMonthly[] {
  const byMonth = new Map<string, PnlListingMonth[]>();
  for (const r of rows) {
    const list = byMonth.get(r.month);
    if (list) list.push(r);
    else byMonth.set(r.month, [r]);
  }
  return monthKeys.map((month) => ({ month, label: monthLabel(month), ...summarize(byMonth.get(month) ?? []) }));
}

export interface PnlPerFlat extends PnlSummary {
  listingId: string;
  label: string;
}

export function perFlatBreakdown(rows: PnlListingMonth[]): PnlPerFlat[] {
  const byFlat = new Map<string, { label: string; rows: PnlListingMonth[] }>();
  for (const r of rows) {
    const e = byFlat.get(r.listingId) ?? { label: r.label, rows: [] };
    e.rows.push(r);
    byFlat.set(r.listingId, e);
  }
  return [...byFlat.entries()]
    .map(([listingId, { label, rows: rs }]) => ({ listingId, label, ...summarize(rs) }))
    .sort((a, b) => b.profit - a.profit);
}
