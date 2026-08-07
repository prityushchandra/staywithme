import type { PnlListingMonth } from "./pnl";

// Pure P&L aggregation (no DB) so the admin page and the Excel export produce
// identical numbers. All money is in paise.

export interface PnlSummary {
  revenueDirect: number;
  revenueOffline: number;
  revenueOnline: number;
  revenueTotal: number;
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

/** Revenue for the chosen channel from a summary's buckets. */
export function sourceRevenue(
  s: { revenueOnline: number; revenueOffline: number; revenueDirect: number },
  source: PnlSource
): number {
  if (source === "online") return s.revenueOnline;
  if (source === "offline") return s.revenueOffline + s.revenueDirect;
  return s.revenueOnline + s.revenueOffline + s.revenueDirect;
}

export function summarize(rows: PnlListingMonth[]): PnlSummary {
  let revenueDirect = 0;
  let revenueOffline = 0;
  let revenueOnline = 0;
  let rent = 0;
  let staff = 0;
  let unbookedDays = 0;
  for (const r of rows) {
    revenueDirect += r.revenueDirect;
    revenueOffline += r.revenueOffline;
    revenueOnline += r.revenueOnline;
    rent += r.rent;
    staff += r.staff;
    unbookedDays += r.unbookedDays;
  }
  const revenueTotal = revenueDirect + revenueOffline + revenueOnline;
  const expenseTotal = rent + staff;
  const profit = revenueTotal - expenseTotal;
  const margin = revenueTotal > 0 ? (profit / revenueTotal) * 100 : 0;
  return { revenueDirect, revenueOffline, revenueOnline, revenueTotal, rent, staff, expenseTotal, profit, margin, unbookedDays };
}

/** Source-scoped {revenue, profit, margin} for a summary. Expenses are fixed. */
export function scopeSummary(s: PnlSummary, source: PnlSource): { revenue: number; profit: number; margin: number } {
  const revenue = sourceRevenue(s, source);
  const profit = revenue - s.expenseTotal;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  return { revenue, profit, margin };
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
